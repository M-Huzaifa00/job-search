import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS scrape_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    params TEXT NOT NULL,
    summary TEXT,
    metrics TEXT
  );

  CREATE TABLE IF NOT EXISTS source_status (
    run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    method TEXT,
    raw_count INTEGER NOT NULL DEFAULT 0,
    unique_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    errors TEXT,
    rejected TEXT,
    duration_ms INTEGER,
    note TEXT,
    finished_at TEXT NOT NULL,
    PRIMARY KEY (run_id, source)
  );
  CREATE INDEX IF NOT EXISTS idx_source_status_source ON source_status(source, finished_at);

  CREATE TABLE IF NOT EXISTS keywords (
    keyword TEXT PRIMARY KEY,
    category TEXT,
    first_used_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    times_used INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    norm_title TEXT NOT NULL,
    company TEXT,
    norm_company TEXT,
    company_domain TEXT,
    location TEXT,
    remote_type TEXT,
    remote_scope TEXT,
    ats_provider TEXT,
    ats_job_id TEXT,
    canonical_url TEXT,
    apply_url TEXT,
    posted_at TEXT,
    original_posted_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    reposted_at TEXT,
    times_seen INTEGER NOT NULL DEFAULT 1,
    last_run_id TEXT,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_jobs_canonical ON jobs(canonical_url);
  CREATE INDEX IF NOT EXISTS idx_jobs_ats ON jobs(ats_provider, ats_job_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_last_seen ON jobs(last_seen_at);

  CREATE TABLE IF NOT EXISTS job_sources (
    source TEXT NOT NULL,
    source_key TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    job_url TEXT,
    posted_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (source, source_key)
  );
  CREATE INDEX IF NOT EXISTS idx_job_sources_job ON job_sources(job_id);

  CREATE TABLE IF NOT EXISTS detail_cache (
    cache_key TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_detail_cache_expires ON detail_cache(expires_at);
  `,
];

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
