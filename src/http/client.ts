import { Agent, ProxyAgent, fetch, type Dispatcher } from 'undici';
import { RateLimiter, Semaphore, jitter, sleep } from '../utils/concurrency.ts';
import type { Logger } from '../utils/logger.ts';
import { SourceError, detectBlockPage, toSourceError } from './errors.ts';

export interface HostPolicy {
  concurrency: number;
  minIntervalMs: number;
  jitterMs: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Cache successful responses for this long (0/undefined = no cache). */
  cacheTtlMs?: number;
  signal?: AbortSignal;
  redirect?: 'follow' | 'manual';
  /** Statuses returned to the caller instead of raising (e.g. 404 on a detail page, 3xx with manual redirects). */
  acceptStatuses?: number[];
  /** Skip reading the body (redirect resolution). */
  skipBody?: boolean;
  /** Disable challenge-page detection (used for arbitrary employer pages). */
  skipBlockDetection?: boolean;
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: Headers;
  text: string;
  fetchedAt: string;
  fromCache: boolean;
}

interface CachedEntry {
  expires: number;
  res: HttpResponse;
}

export interface HttpClientOptions {
  timeoutMs: number;
  maxRetries: number;
  maxRetryAfterMs: number;
  userAgent: string;
  proxyUrl?: string;
  logger: Logger;
  defaultPolicy?: HostPolicy;
}

const DEFAULT_POLICY: HostPolicy = { concurrency: 2, minIntervalMs: 500, jitterMs: 250 };
const MAX_CACHE_ENTRIES = 500;

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export class HttpClient {
  private readonly dispatcher: Dispatcher;
  private readonly opts: HttpClientOptions;
  private readonly policies = new Map<string, HostPolicy>();
  private readonly hostState = new Map<string, { sem: Semaphore; limiter: RateLimiter }>();
  private readonly cache = new Map<string, CachedEntry>();
  private readonly inflight = new Map<string, Promise<HttpResponse>>();

  constructor(opts: HttpClientOptions) {
    this.opts = opts;
    this.dispatcher = opts.proxyUrl
      ? new ProxyAgent({ uri: opts.proxyUrl, keepAliveTimeout: 10_000, connections: 32 })
      : new Agent({ keepAliveTimeout: 10_000, connections: 32, connect: { timeout: 15_000 } });
  }

  setHostPolicy(host: string, policy: Partial<HostPolicy>): void {
    const merged = { ...(this.opts.defaultPolicy ?? DEFAULT_POLICY), ...this.policies.get(host), ...policy };
    this.policies.set(host, merged);
    this.hostState.delete(host);
  }

  private stateFor(host: string) {
    let st = this.hostState.get(host);
    if (!st) {
      const p = this.policies.get(host) ?? this.opts.defaultPolicy ?? DEFAULT_POLICY;
      st = { sem: new Semaphore(p.concurrency), limiter: new RateLimiter(p.minIntervalMs, p.jitterMs) };
      this.hostState.set(host, st);
    }
    return st;
  }

  async request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const method = opts.method ?? 'GET';
    const key = `${method} ${url} ${opts.body ?? ''}`;
    const ttl = opts.cacheTtlMs ?? 0;
    if (ttl > 0) {
      const hit = this.cache.get(key);
      if (hit && hit.expires > Date.now()) return { ...hit.res, fromCache: true };
      const pending = this.inflight.get(key);
      if (pending) return pending.then((r) => ({ ...r, fromCache: true }));
    }
    const p = this.execute(url, method, opts);
    if (ttl > 0) this.inflight.set(key, p);
    try {
      const res = await p;
      if (ttl > 0 && res.status >= 200 && res.status < 300) {
        if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: Date.now() + ttl, res });
      }
      return res;
    } finally {
      if (ttl > 0) this.inflight.delete(key);
    }
  }

  private async execute(url: string, method: string, opts: RequestOptions): Promise<HttpResponse> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new SourceError('HTTP_ERROR', `invalid URL: ${url}`);
    }
    const retries = opts.retries ?? this.opts.maxRetries;
    const log = this.opts.logger;
    let lastErr: SourceError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new SourceError('ABORTED', 'run aborted', { url });
      const st = this.stateFor(host);
      const release = await st.sem.acquire();
      const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? this.opts.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
      try {
        await st.limiter.wait(opts.signal);
        const res = await fetch(url, {
          method,
          body: opts.body,
          redirect: opts.redirect ?? 'follow',
          dispatcher: this.dispatcher,
          signal,
          headers: {
            'user-agent': this.opts.userAgent,
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            ...opts.headers,
          },
        });
        const fetchedAt = new Date().toISOString();
        const text = opts.skipBody || method === 'HEAD' ? '' : await res.text();
        if (opts.skipBody) await res.body?.cancel().catch(() => {});
        const headers = res.headers as unknown as Headers;
        const accepted = opts.acceptStatuses?.includes(res.status) ?? false;

        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          lastErr = new SourceError('RATE_LIMITED', `HTTP 429 from ${host}`, { status: 429, url, retryAfterMs: retryAfter });
          if (attempt < retries && (retryAfter ?? 0) <= this.opts.maxRetryAfterMs) {
            const wait = retryAfter ?? this.backoff(attempt) * 2;
            st.limiter.pause(wait);
            log.warn('rate limited, backing off', { host, attempt: attempt + 1, waitMs: wait });
            release();
            await sleep(wait, opts.signal);
            continue;
          }
          throw lastErr;
        }

        if (!opts.skipBlockDetection) {
          const block = detectBlockPage(res.status, headers, text);
          if (block) throw new SourceError('BLOCKED', `${block} (HTTP ${res.status})`, { status: res.status, url });
        }

        if (accepted || (res.status >= 200 && res.status < 400)) {
          return { status: res.status, url: res.url || url, headers, text, fetchedAt, fromCache: false };
        }
        if (res.status === 401 || res.status === 407) throw new SourceError('AUTH_REQUIRED', `HTTP ${res.status} from ${host}`, { status: res.status, url });
        if (res.status === 403) throw new SourceError('BLOCKED', `HTTP 403 from ${host}`, { status: res.status, url });
        if (res.status === 404 || res.status === 410) throw new SourceError('NOT_FOUND', `HTTP ${res.status} from ${host}`, { status: res.status, url });
        if (res.status >= 500 && attempt < retries) {
          lastErr = new SourceError('HTTP_ERROR', `HTTP ${res.status} from ${host}`, { status: res.status, url });
          const wait = this.backoff(attempt);
          log.warn('server error, retrying', { host, status: res.status, attempt: attempt + 1, waitMs: wait });
          release();
          await sleep(wait, opts.signal);
          continue;
        }
        throw new SourceError('HTTP_ERROR', `HTTP ${res.status} from ${host}`, { status: res.status, url });
      } catch (err) {
        let e = err instanceof SourceError ? err : toSourceError(err);
        if (!(err instanceof SourceError) && timeoutSignal.aborted && !opts.signal?.aborted) {
          e = new SourceError('TIMEOUT', `timed out after ${opts.timeoutMs ?? this.opts.timeoutMs}ms (${host})`, { url });
        } else if (opts.signal?.aborted) {
          e = new SourceError('ABORTED', 'run aborted', { url });
        }
        const retryable = e.category === 'NETWORK_ERROR' || e.category === 'TIMEOUT';
        lastErr = e;
        if (retryable && attempt < retries) {
          const wait = this.backoff(attempt);
          log.warn('request failed, retrying', { host, category: e.category, error: e.message, attempt: attempt + 1, waitMs: wait });
          release();
          await sleep(wait, opts.signal).catch(() => {});
          continue;
        }
        throw e;
      } finally {
        release();
      }
    }
    throw lastErr ?? new SourceError('NETWORK_ERROR', `request failed: ${host}`);
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 1_000 * 2 ** attempt) + jitter(600);
  }

  async close(): Promise<void> {
    await this.dispatcher.close().catch(() => {});
  }
}

/** Per-source façade: counts requests so each source's report shows its own traffic. */
export class SourceHttp {
  requests = 0;
  private readonly client: HttpClient;

  constructor(client: HttpClient) {
    this.client = client;
  }

  async request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const res = await this.client.request(url, opts);
    if (!res.fromCache) this.requests++;
    return res;
  }

  async getText(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    return this.request(url, { ...opts, method: 'GET' });
  }

  async getJson<T>(url: string, opts: RequestOptions = {}): Promise<{ data: T; res: HttpResponse }> {
    const res = await this.request(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
    return { data: parseJson<T>(res.text, url), res };
  }
}

export function parseJson<T>(text: string, url: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new SourceError('PARSING_ERROR', `invalid JSON from ${safeHost(url)}`, { url, cause: err });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}
