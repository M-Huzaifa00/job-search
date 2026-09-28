import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SOURCE_IDS, type SourceId } from '../models/job.ts';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim())));

const int = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `must be an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

const sourceList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return undefined;
    const ids = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const unknown = ids.filter((id) => !(SOURCE_IDS as readonly string[]).includes(id));
    if (unknown.length) {
      ctx.addIssue({ code: 'custom', message: `unknown source(s): ${unknown.join(', ')}` });
      return z.NEVER;
    }
    return ids as SourceId[];
  });

const EnvSchema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  PORT: int(3001, 1, 65535),
  HOST: z.string().optional().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  PERSIST: bool(true),

  MAX_CONCURRENCY: int(6, 1, 50),
  REQUEST_TIMEOUT_MS: int(20_000, 1_000, 120_000),
  MAX_RETRIES: int(3, 0, 8),
  MAX_RETRY_AFTER_MS: int(60_000, 1_000, 600_000),
  RUN_TIMEOUT_MS: int(900_000, 10_000, 3_600_000),

  MAX_PAGES_PER_KEYWORD: int(3, 1, 20),
  MAX_RESULTS_PER_SOURCE: int(600, 1, 10_000),
  MAX_RESULTS_PER_KEYWORD: int(100, 1, 1_000),
  DEFAULT_HOURS_OLD: int(24, 1, 720),

  FETCH_DETAILS: bool(true),
  MAX_DETAILS_PER_SOURCE: int(150, 0, 2_000),
  VALIDATE_URLS: z.enum(['off', 'redirects', 'all']).optional().default('redirects'),
  MAX_URL_VALIDATIONS: int(200, 0, 5_000),
  INCLUDE_UNDATED: bool(true),
  EXCLUDE_REPOST_AGGREGATORS: bool(true),
  ALLOW_INDEED_NETWORK_SOURCES: bool(false),
  EXCLUDE_INDEED: bool(true),
  PROBE_BLOCKED_SOURCES: bool(true),

  SEARCH_CACHE_TTL_MS: int(600_000, 0, 86_400_000),
  DETAIL_CACHE_TTL_HOURS: int(24, 0, 720),

  ENABLED_SOURCES: sourceList,
  DISABLED_SOURCES: sourceList,

  USER_AGENT: z
    .string()
    .optional()
    .default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'),
  PROXY_URL: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).optional().default('pretty'),
  CSV_BOM: bool(true),

  JOOBLE_API_KEY: z.string().optional(),
  CAREERJET_AFFID: z.string().optional(),
  CAREERJET_REFERER: z.string().optional().default('http://localhost/medical-remote-job-aggregator'),
});

export type AppConfig = ReturnType<typeof buildConfig>;

let envLoaded = false;

/** Loads `.env` from the working directory (if present) using Node's built-in loader. */
export function loadDotEnv(file = '.env'): void {
  if (envLoaded) return;
  envLoaded = true;
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) process.loadEnvFile(path);
}

function perSourceOverrides(env: NodeJS.ProcessEnv) {
  const overrides: Partial<Record<SourceId, { concurrency?: number; minIntervalMs?: number }>> = {};
  for (const id of SOURCE_IDS) {
    const key = id.toUpperCase();
    const c = Number(env[`SOURCE_CONCURRENCY_${key}`]);
    const i = Number(env[`SOURCE_MIN_INTERVAL_MS_${key}`]);
    if (Number.isInteger(c) && c > 0) overrides[id] = { ...overrides[id], concurrency: c };
    if (Number.isInteger(i) && i >= 0) overrides[id] = { ...overrides[id], minIntervalMs: i };
  }
  return overrides;
}

function resolveDatabasePath(databaseUrl?: string, databasePath?: string): string {
  if (databasePath) return resolve(databasePath);
  if (databaseUrl) {
    const stripped = databaseUrl.replace(/^sqlite:(\/\/)?/i, '').replace(/^file:(\/\/)?/i, '');
    return resolve(stripped);
  }
  return resolve('data/jobs.db');
}

export function buildConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    host: e.HOST,
    databasePath: resolveDatabasePath(e.DATABASE_URL, e.DATABASE_PATH),
    persist: e.PERSIST,

    maxConcurrency: e.MAX_CONCURRENCY,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
    maxRetries: e.MAX_RETRIES,
    maxRetryAfterMs: e.MAX_RETRY_AFTER_MS,
    runTimeoutMs: e.RUN_TIMEOUT_MS,

    maxPagesPerKeyword: e.MAX_PAGES_PER_KEYWORD,
    maxResultsPerSource: e.MAX_RESULTS_PER_SOURCE,
    maxResultsPerKeyword: e.MAX_RESULTS_PER_KEYWORD,
    defaultHoursOld: e.DEFAULT_HOURS_OLD,

    fetchDetails: e.FETCH_DETAILS,
    maxDetailsPerSource: e.MAX_DETAILS_PER_SOURCE,
    validateUrls: e.VALIDATE_URLS,
    maxUrlValidations: e.MAX_URL_VALIDATIONS,
    includeUndated: e.INCLUDE_UNDATED,
    excludeRepostAggregators: e.EXCLUDE_REPOST_AGGREGATORS,
    allowIndeedNetworkSources: e.ALLOW_INDEED_NETWORK_SOURCES,
    /** Drop listings whose URL or application goes through Indeed (indeed.com itself is never requested). */
    excludeIndeed: e.EXCLUDE_INDEED,
    probeBlockedSources: e.PROBE_BLOCKED_SOURCES,

    searchCacheTtlMs: e.SEARCH_CACHE_TTL_MS,
    detailCacheTtlHours: e.DETAIL_CACHE_TTL_HOURS,

    enabledSources: e.ENABLED_SOURCES,
    disabledSources: e.DISABLED_SOURCES ?? [],
    sourceOverrides: perSourceOverrides(env),

    userAgent: e.USER_AGENT,
    proxyUrl: e.PROXY_URL?.trim() || undefined,

    logLevel: e.LOG_LEVEL,
    logFormat: e.LOG_FORMAT,
    csvBom: e.CSV_BOM,

    keys: {
      jooble: e.JOOBLE_API_KEY?.trim() || undefined,
      careerjetAffid: e.CAREERJET_AFFID?.trim() || undefined,
    },
    careerjetReferer: e.CAREERJET_REFERER,
  };
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  return buildConfig(process.env);
}
