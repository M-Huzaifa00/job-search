import type { AppConfig } from '../config/env.ts';
import { openDatabase, type Db } from '../db/database.ts';
import { Repository } from '../db/repository.ts';
import { HttpClient } from '../http/client.ts';
import { allAdapters } from '../sources/registry.ts';
import { createLogger, type Logger } from '../utils/logger.ts';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  http: HttpClient;
  db: Db | null;
  repo: Repository | null;
  close(): Promise<void>;
}

export function createAppContext(config: AppConfig, overrides: { logger?: Logger; persist?: boolean } = {}): AppContext {
  const logger = overrides.logger ?? createLogger({ level: config.logLevel, format: config.logFormat });
  const http = new HttpClient({
    timeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    maxRetryAfterMs: config.maxRetryAfterMs,
    userAgent: config.userAgent,
    proxyUrl: config.proxyUrl,
    logger: logger.child('http'),
  });

  // Source-specific rate limits, with optional SOURCE_MIN_INTERVAL_MS_<ID> overrides.
  for (const adapter of allAdapters()) {
    const override = config.sourceOverrides[adapter.meta.id];
    for (const [host, policy] of Object.entries(adapter.meta.hostPolicies)) {
      http.setHostPolicy(host, { ...policy, ...(override?.minIntervalMs !== undefined ? { minIntervalMs: override.minIntervalMs } : {}) });
    }
  }

  const persist = overrides.persist ?? config.persist;
  let db: Db | null = null;
  let repo: Repository | null = null;
  if (persist) {
    db = openDatabase(config.databasePath);
    repo = new Repository(db);
    repo.pruneExpiredCache();
  }

  if (config.proxyUrl) logger.info('using HTTP proxy', { proxy: config.proxyUrl });

  return {
    config,
    logger,
    http,
    db,
    repo,
    async close() {
      await http.close();
      db?.close();
    },
  };
}
