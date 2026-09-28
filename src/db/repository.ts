import type { NormalizedJob } from '../models/job.ts';
import type { RunMetrics, SearchRequest, SearchSummary, SourceRunReport } from '../models/search.ts';
import { dedupKeys } from '../core/dedup/dedup.ts';
import type { Db } from './database.ts';

const REPOST_THRESHOLD_MS = 12 * 3_600_000;

export interface StoredSourceStatus {
  source: string;
  status: string;
  raw_count: number;
  accepted_count: number;
  errors: string | null;
  finished_at: string;
}

type Row = Record<string, unknown>;

export class Repository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // ---------------------------------------------------------------- runs
  createRun(id: string, params: SearchRequest, startedAt: string): void {
    this.db.prepare('INSERT INTO scrape_runs (id, started_at, status, params) VALUES (?, ?, ?, ?)').run(id, startedAt, 'running', JSON.stringify(params));
  }

  finishRun(id: string, status: string, summary: SearchSummary, metrics: RunMetrics): void {
    this.db
      .prepare('UPDATE scrape_runs SET finished_at = ?, status = ?, summary = ?, metrics = ? WHERE id = ?')
      .run(new Date().toISOString(), status, JSON.stringify(summary), JSON.stringify(metrics), id);
  }

  saveSourceStatuses(runId: string, reports: SourceRunReport[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO source_status
        (run_id, source, status, method, raw_count, unique_count, accepted_count, requests, errors, rejected, duration_ms, note, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const r of reports) {
        stmt.run(runId, r.source, r.status, r.method, r.raw, r.unique, r.accepted, r.requests, JSON.stringify(r.errors.slice(0, 20)), JSON.stringify(r.rejected), r.durationMs, r.note ?? null, now);
      }
    });
  }

  listRuns(limit = 20): Row[] {
    return (this.db.prepare('SELECT id, started_at, finished_at, status, params, summary, metrics FROM scrape_runs ORDER BY started_at DESC LIMIT ?').all(limit) as Row[]).map(parseJsonColumns);
  }

  getRun(id: string): Row | null {
    const run = this.db.prepare('SELECT * FROM scrape_runs WHERE id = ?').get(id) as Row | undefined;
    if (!run) return null;
    const sources = (this.db.prepare('SELECT * FROM source_status WHERE run_id = ? ORDER BY source').all(id) as Row[]).map(parseJsonColumns);
    return { ...parseJsonColumns(run), sources };
  }

  /** Most recent recorded status per source (for GET /api/sources). */
  lastSourceStatuses(): Map<string, StoredSourceStatus> {
    const rows = this.db
      .prepare(
        `SELECT s.source, s.status, s.raw_count, s.accepted_count, s.errors, s.finished_at
         FROM source_status s
         JOIN (SELECT source, MAX(finished_at) AS f FROM source_status GROUP BY source) m
           ON m.source = s.source AND m.f = s.finished_at`,
      )
      .all() as unknown as StoredSourceStatus[];
    return new Map(rows.map((r) => [r.source, r]));
  }

  // ---------------------------------------------------------------- keywords
  touchKeywords(terms: string[], categoryOf: (term: string) => string | null): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO keywords (keyword, category, first_used_at, last_used_at, times_used) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(keyword) DO UPDATE SET last_used_at = excluded.last_used_at, times_used = times_used + 1`);
    this.transaction(() => {
      for (const t of terms) stmt.run(t, categoryOf(t), now, now);
    });
  }

  // ---------------------------------------------------------------- jobs
  /**
   * Upserts the deduplicated jobs. Existing records are matched by source listing id, canonical URL,
   * ATS id, or employer+title fingerprint, so a repost keeps its original first_seen_at.
   * Mutates each job's persistence fields (id, first_seen_at, last_seen_at, reposted_at, is_new).
   */
  upsertJobs(unique: NormalizedJob[], duplicates: NormalizedJob[], runId: string, now = new Date()): void {
    const nowIso = now.toISOString();
    const membersOf = new Map<string, NormalizedJob[]>();
    for (const d of duplicates) {
      const list = membersOf.get(d.duplicate_of!) ?? [];
      list.push(d);
      membersOf.set(d.duplicate_of!, list);
    }

    const findBySource = this.db.prepare('SELECT job_id FROM job_sources WHERE source = ? AND source_key = ?');
    const findByUrl = this.db.prepare('SELECT id FROM jobs WHERE canonical_url = ? LIMIT 1');
    const findByAts = this.db.prepare('SELECT id FROM jobs WHERE ats_provider = ? AND ats_job_id = ? AND norm_company = ? LIMIT 1');
    const findByFingerprint = this.db.prepare('SELECT id FROM jobs WHERE fingerprint = ? ORDER BY first_seen_at LIMIT 1');
    const getJob = this.db.prepare('SELECT id, posted_at, original_posted_at, first_seen_at, reposted_at FROM jobs WHERE id = ?');
    const insertJob = this.db.prepare(`
      INSERT INTO jobs (id, fingerprint, title, norm_title, company, norm_company, company_domain, location, remote_type, remote_scope,
        ats_provider, ats_job_id, canonical_url, apply_url, posted_at, original_posted_at, first_seen_at, last_seen_at, reposted_at,
        times_seen, last_run_id, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`);
    const updateJob = this.db.prepare(`
      UPDATE jobs SET title = ?, company = ?, location = ?, remote_type = ?, remote_scope = ?, apply_url = ?, canonical_url = ?,
        ats_provider = COALESCE(?, ats_provider), ats_job_id = COALESCE(?, ats_job_id), posted_at = ?, last_seen_at = ?,
        reposted_at = ?, times_seen = times_seen + 1, last_run_id = ?, data = ?
      WHERE id = ?`);
    const upsertSource = this.db.prepare(`
      INSERT INTO job_sources (source, source_key, job_id, job_url, posted_at, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_key) DO UPDATE SET job_id = excluded.job_id, last_seen_at = excluded.last_seen_at, posted_at = excluded.posted_at`);

    this.transaction(() => {
      for (const job of unique) {
        const members = [job, ...(membersOf.get(job.id) ?? [])];
        const keys = dedupKeys(job);
        const fingerprint = `${keys.company}|${keys.title}`;

        let existingId: string | undefined;
        for (const m of members) {
          const r = findBySource.get(m.source_id, m.source_job_id ?? m.job_url) as { job_id: string } | undefined;
          if (r) {
            existingId = r.job_id;
            break;
          }
        }
        existingId ??= (findByUrl.get(job.canonical_url) as { id: string } | undefined)?.id;
        if (!existingId && job.ats_provider && job.ats_job_id) {
          existingId = (findByAts.get(job.ats_provider, job.ats_job_id, keys.company) as { id: string } | undefined)?.id;
        }
        if (!existingId && keys.company && keys.title) existingId = (findByFingerprint.get(fingerprint) as { id: string } | undefined)?.id;

        const oldId = job.id;
        if (existingId) {
          const prev = getJob.get(existingId) as { posted_at: string | null; original_posted_at: string | null; first_seen_at: string; reposted_at: string | null };
          let repostedAt = prev.reposted_at;
          const original = prev.original_posted_at ?? prev.posted_at;
          if (job.posted_at && original && Date.parse(job.posted_at) - Date.parse(original) > REPOST_THRESHOLD_MS) repostedAt = job.posted_at;
          job.id = existingId;
          job.first_seen_at = prev.first_seen_at;
          job.last_seen_at = nowIso;
          job.reposted_at = repostedAt;
          job.is_new = false;
          updateJob.run(
            job.title,
            job.company,
            job.location,
            job.remote_type,
            job.remote_scope,
            job.apply_url,
            job.canonical_url,
            job.ats_provider,
            job.ats_job_id,
            job.posted_at,
            nowIso,
            repostedAt,
            runId,
            JSON.stringify(stripForStorage(job)),
            existingId,
          );
        } else {
          job.first_seen_at = nowIso;
          job.last_seen_at = nowIso;
          job.is_new = true;
          insertJob.run(
            job.id,
            fingerprint,
            job.title,
            keys.title,
            job.company,
            keys.company,
            job.company_domain,
            job.location,
            job.remote_type,
            job.remote_scope,
            job.ats_provider,
            job.ats_job_id,
            job.canonical_url,
            job.apply_url,
            job.posted_at,
            job.posted_at,
            nowIso,
            nowIso,
            runId,
            JSON.stringify(stripForStorage(job)),
          );
        }
        for (const m of members) {
          if (m !== job) m.duplicate_of = job.id;
          upsertSource.run(m.source_id, m.source_job_id ?? m.job_url, job.id, m.job_url, m.posted_at, nowIso, nowIso);
        }
        if (oldId !== job.id) for (const d of duplicates) if (d.duplicate_of === oldId) d.duplicate_of = job.id;
      }
    });
  }

  /** Jobs persisted by earlier runs, most recently seen first. `stale` marks listings not seen recently. */
  listJobs(opts: { seenWithinHours?: number; limit?: number } = {}): Row[] {
    const since = new Date(Date.now() - (opts.seenWithinHours ?? 72) * 3_600_000).toISOString();
    const staleBefore = Date.now() - 48 * 3_600_000;
    const rows = this.db
      .prepare('SELECT data, first_seen_at, last_seen_at, reposted_at, times_seen FROM jobs WHERE last_seen_at >= ? ORDER BY last_seen_at DESC, posted_at DESC LIMIT ?')
      .all(since, opts.limit ?? 500) as Row[];
    return rows.map((r) => ({
      ...(JSON.parse(String(r.data)) as Row),
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      reposted_at: r.reposted_at,
      times_seen: r.times_seen,
      status: Date.parse(String(r.last_seen_at)) < staleBefore ? 'stale' : 'active',
    }));
  }

  // ---------------------------------------------------------------- detail cache
  getDetail<T>(key: string): T | null {
    const row = this.db.prepare('SELECT payload, expires_at FROM detail_cache WHERE cache_key = ?').get(key) as { payload: string; expires_at: string } | undefined;
    if (!row || Date.parse(row.expires_at) < Date.now()) return null;
    try {
      return JSON.parse(row.payload) as T;
    } catch {
      return null;
    }
  }

  setDetail(key: string, payload: unknown, ttlHours: number): void {
    if (ttlHours <= 0) return;
    const now = Date.now();
    this.db
      .prepare('INSERT OR REPLACE INTO detail_cache (cache_key, fetched_at, expires_at, payload) VALUES (?, ?, ?, ?)')
      .run(key, new Date(now).toISOString(), new Date(now + ttlHours * 3_600_000).toISOString(), JSON.stringify(payload));
  }

  pruneExpiredCache(): void {
    this.db.prepare('DELETE FROM detail_cache WHERE expires_at < ?').run(new Date().toISOString());
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function stripForStorage(job: NormalizedJob): Partial<NormalizedJob> {
  const { rejection: _r, ...rest } = job;
  return rest;
}

function parseJsonColumns(row: Row): Row {
  const out: Row = { ...row };
  for (const k of ['params', 'summary', 'metrics', 'errors', 'rejected']) {
    if (typeof out[k] === 'string') {
      try {
        out[k] = JSON.parse(out[k] as string);
      } catch {
        /* keep raw string */
      }
    }
  }
  return out;
}
