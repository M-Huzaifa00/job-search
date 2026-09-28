import type { AppConfig } from '../config/env.ts';
import type { ErrorCategory } from '../http/errors.ts';
import type { HostPolicy, SourceHttp } from '../http/client.ts';
import type { RawJob, SourceId } from '../models/job.ts';
import type { Logger } from '../utils/logger.ts';

/**
 * working       – implemented and verified against the live site
 * requires_key  – implemented against the official API; needs credentials to run
 * restricted    – works, but disabled by default by policy (see notes)
 * blocked       – the platform serves bot challenges / CAPTCHAs to automated clients; probe-only
 * degraded      – implemented but currently unreliable
 */
export type SourceStatus = 'working' | 'degraded' | 'blocked' | 'requires_key' | 'restricted' | 'unsupported';

export interface SourceMeta {
  id: SourceId;
  name: string;
  /** Access method, in the preference order api > feed > http-json > http-html > browser. */
  method: 'api' | 'rss' | 'http-json' | 'http-html' | 'probe-only';
  methodDetail: string;
  status: SourceStatus;
  defaultEnabled: boolean;
  homepage: string;
  notes: string;
  /** What it would take to support the source properly (for blocked / key-gated sources). */
  requirement?: string;
  hostPolicies: Record<string, Partial<HostPolicy>>;
  /** Max keyword tasks for this source running at once. */
  concurrency: number;
  supportsDetails: boolean;
  /** Pages are meaningless for feed-style sources (one request returns everything). */
  maxPages?: number;
}

export interface SearchQuery {
  keyword: string;
  country: 'US';
  remoteOnly: boolean;
  hoursOld: number;
  page: number;
  maxResults: number;
}

export interface SearchPage {
  jobs: RawJob[];
  hasMore: boolean;
  requestUrl?: string;
  total?: number;
}

export interface SourceContext {
  http: SourceHttp;
  log: Logger;
  signal: AbortSignal;
  config: AppConfig;
}

export interface ProbeResult {
  ok: boolean;
  category?: ErrorCategory;
  message: string;
  httpStatus?: number;
}

export interface SourceAdapter {
  meta: SourceMeta;
  /** Returns why the adapter cannot run with the current configuration (e.g. missing API key). */
  unavailableReason?(config: AppConfig): { category: ErrorCategory; message: string } | null;
  searchJobs(q: SearchQuery, ctx: SourceContext): Promise<SearchPage>;
  /** Fetches the job-detail page; returns the fields it could extract. */
  fetchDetails?(job: RawJob, ctx: SourceContext): Promise<Partial<RawJob> | null>;
  /** One lightweight request to check reachability (used for health checks and blocked sources). */
  probe?(ctx: SourceContext): Promise<ProbeResult>;
}
