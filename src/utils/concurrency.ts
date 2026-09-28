export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function jitter(maxMs: number): number {
  return maxMs > 0 ? Math.floor(Math.random() * maxMs) : 0;
}

/** Counting semaphore: bounds how many tasks run at once. */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Spaces out request starts: each caller gets a slot at least `minIntervalMs` (+ random jitter)
 * after the previous one. Works across concurrent callers.
 */
export class RateLimiter {
  private nextSlot = 0;
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;

  constructor(minIntervalMs: number, jitterMs = 0) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
    this.jitterMs = Math.max(0, jitterMs);
  }

  async wait(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs + jitter(this.jitterMs);
    const delay = slot - now;
    if (delay > 0) await sleep(delay, signal);
  }

  /** Push the next slot out, e.g. after a 429 with Retry-After. */
  pause(ms: number): void {
    this.nextSlot = Math.max(this.nextSlot, Date.now() + ms);
  }
}

/** Runs `worker` over `items` with at most `limit` in flight; results keep input order. */
export async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
