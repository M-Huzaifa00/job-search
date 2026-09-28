import { randomBytes } from 'node:crypto';
import { knownTerm, titleLooksRelevant } from '../core/classifier/relevance.ts';
import { deduplicate } from '../core/dedup/dedup.ts';
import { resolvePostedDate } from '../core/normalization/date.ts';
import { isValidFinalJob } from '../core/pipeline/finalFilter.ts';
import { normalizeJob, type NormalizeOptions } from '../core/pipeline/normalize.ts';
import { rankJobs } from '../core/ranking/rank.ts';
import { SourceHttp } from '../http/client.ts';
import { isFatalForSource, toSourceError, type ErrorCategory } from '../http/errors.ts';
import type { NormalizedJob, RawJob, RejectionReason, SourceId } from '../models/job.ts';
import type { RunMetrics, SearchRequest, SearchResult, SearchSummary, SourceRunReport, SourceRunStatus } from '../models/search.ts';
import { defaultSourceIds, getAdapter, sourceName } from '../sources/registry.ts';
import type { SourceAdapter, SourceContext } from '../sources/types.ts';
import { Semaphore, mapPool } from '../utils/concurrency.ts';
import type { AppContext } from './context.ts';
import { validateLinks } from './linkValidator.ts';
import { formatMetrics, formatSourceReport, formatSummaryLine } from './report.ts';

interface SourceState {
  id: SourceId;
  adapter: SourceAdapter;
  ctx: SourceContext;
  sem: Semaphore;
  report: SourceRunReport;
  raw: Map<string, RawJob>;
  dead: { category: ErrorCategory; message: string } | null;
  rateLimitHits: number;
  detailFailures: number;
  started: number;
}

function dedupeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const clean = t.trim().replace(/\s+/g, ' ');
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

function mergeDetails(raw: RawJob, details: Partial<RawJob>): RawJob {
  const merged: RawJob = { ...raw };
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined) continue;
    // Never let a detail page erase data we already have with an empty value.
    if (v === null && (merged as unknown as Record<string, unknown>)[k] !== undefined && k !== 'applyUrl') continue;
    (merged as unknown as Record<string, unknown>)[k] = v;
  }
  merged.foundBy = raw.foundBy;
  merged.detailFetched = true;
  return merged;
}

function statusOf(s: SourceState): SourceRunStatus {
  if (s.dead?.category === 'BLOCKED') return 'BLOCKED';
  if (s.dead && s.report.raw === 0) return 'ERROR';
  if (s.report.errors.length > 0 && s.report.raw === 0) return 'ERROR';
  if (s.report.errors.length > 0 || s.dead) return 'PARTIAL';
  return 'OK';
}

export async function runSearch(app: AppContext, req: SearchRequest, opts: { signal?: AbortSignal } = {}): Promise<SearchResult> {
  const { config, logger } = app;
  const started = Date.now();
  const runId = `run_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${randomBytes(3).toString('hex')}`;
  const log = logger.child('Search');

  const terms = dedupeTerms(req.titles);
  const hoursOld = req.hoursOld;
  const maxPages = req.maxPagesPerKeyword ?? config.maxPagesPerKeyword;
  const maxPerSource = req.maxResultsPerSource ?? config.maxResultsPerSource;
  const maxPerKeyword = req.maxResultsPerKeyword ?? config.maxResultsPerKeyword;
  const includeUndated = req.includeUndated ?? config.includeUndated;
  const fetchDetails = req.fetchDetails ?? config.fetchDetails;
  const persist = (req.persist ?? true) && !!app.repo;
  const explicitSources = !!req.sources?.length;
  const sourceIds = [...new Set(req.sources?.length ? req.sources : defaultSourceIds(config))];
  const query: SearchRequest = { ...req, titles: terms, sources: sourceIds };

  const timeoutSignal = AbortSignal.timeout(config.runTimeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

  log.info('run started', { run: runId, keywords: terms.length, sources: sourceIds.join(','), hoursOld, remoteOnly: req.remoteOnly, maxPages });
  if (persist) {
    app.repo!.createRun(runId, query, new Date(started).toISOString());
    app.repo!.touchKeywords(terms, (t) => (knownTerm(t) ? 'default' : 'custom'));
  }

  // ------------------------------------------------------------ source setup
  const states: SourceState[] = [];
  const probes: Promise<void>[] = [];
  for (const id of sourceIds) {
    const adapter = getAdapter(id);
    const ctx: SourceContext = { http: new SourceHttp(app.http), log: logger.child(adapter.meta.name), signal, config };
    const state: SourceState = {
      id,
      adapter,
      ctx,
      sem: new Semaphore(config.sourceOverrides[id]?.concurrency ?? adapter.meta.concurrency),
      report: {
        source: id,
        name: adapter.meta.name,
        status: 'OK',
        method: adapter.meta.method,
        raw: 0,
        unique: 0,
        accepted: 0,
        requests: 0,
        detailsFetched: 0,
        errors: [],
        rejected: {},
        durationMs: 0,
      },
      raw: new Map(),
      dead: null,
      rateLimitHits: 0,
      detailFailures: 0,
      started: Date.now(),
    };
    const unavailable = adapter.unavailableReason?.(config) ?? null;
    if (unavailable) {
      state.dead = unavailable;
      state.report.status = unavailable.category === 'BLOCKED' ? 'BLOCKED' : 'SKIPPED';
      state.report.note = unavailable.message;
      if (unavailable.category === 'BLOCKED' && explicitSources && config.probeBlockedSources && adapter.probe) {
        probes.push(
          adapter
            .probe(ctx)
            .then((p) => {
              state.report.note = `${p.category ?? 'BLOCKED'}: ${p.message}`;
              ctx.log.warn('source unavailable', { category: p.category, detail: p.message });
            })
            .catch((err) => {
              state.report.note = `probe failed: ${toSourceError(err).message}`;
            }),
        );
      } else {
        ctx.log.warn('source skipped', { category: unavailable.category, reason: unavailable.message });
      }
    }
    states.push(state);
  }

  // ------------------------------------------------------------ search phase
  const globalSem = new Semaphore(config.maxConcurrency);
  const cutoffMs = hoursOld * 3_600_000;
  let rawListings = 0;

  const recordError = (s: SourceState, err: unknown, keyword?: string) => {
    const e = toSourceError(err);
    if (e.category === 'ABORTED') return e;
    s.report.errors.push({ category: e.category, message: e.message, keyword });
    if (isFatalForSource(e)) s.dead ??= { category: e.category, message: e.message };
    if (e.category === 'RATE_LIMITED' && ++s.rateLimitHits >= 2) s.dead ??= { category: e.category, message: 'repeatedly rate limited; stopping this source for the run' };
    s.ctx.log.warn(`${e.category.toLowerCase()}`, { keyword, error: e.message });
    return e;
  };

  const searchTask = async (s: SourceState, keyword: string) => {
    const pagesAllowed = Math.min(maxPages, s.adapter.meta.maxPages ?? maxPages);
    let keywordCount = 0;
    for (let page = 1; page <= pagesAllowed; page++) {
      if (s.dead || signal.aborted || s.raw.size >= maxPerSource) break;
      let result;
      // Source slot first: tasks queued behind a slow source must not hold global slots.
      const releaseSource = await s.sem.acquire();
      const releaseGlobal = await globalSem.acquire();
      try {
        if (s.dead || signal.aborted) break;
        result = await s.adapter.searchJobs({ keyword, country: 'US', remoteOnly: req.remoteOnly, hoursOld, page, maxResults: maxPerKeyword }, s.ctx);
      } catch (err) {
        recordError(s, err, keyword);
        break;
      } finally {
        releaseSource();
        releaseGlobal();
      }

      let added = 0;
      let allOld = result.jobs.length > 0;
      for (const job of result.jobs) {
        const key = job.sourceJobId ?? job.jobUrl;
        const existing = s.raw.get(key);
        if (existing) {
          if (!existing.foundBy.includes(keyword)) existing.foundBy.push(keyword);
        } else if (s.raw.size < maxPerSource) {
          s.raw.set(key, job);
          added++;
        }
        const d = resolvePostedDate({ postedAt: job.postedAt, postedText: job.postedText }, job.fetchedAt);
        if (!d.postedAt || Date.now() - Date.parse(d.postedAt) <= cutoffMs) allOld = false;
      }
      s.report.raw += result.jobs.length;
      rawListings += result.jobs.length;
      keywordCount += result.jobs.length;
      s.ctx.log.info(`keyword="${keyword}" page=${page} results=${result.jobs.length}`, { new: added, ...(result.total !== undefined ? { total: result.total } : {}) });

      if (result.jobs.length === 0 || !result.hasMore) break;
      if (added === 0) {
        s.ctx.log.debug('repeated page, stopping pagination', { keyword, page });
        break;
      }
      if (allOld) {
        s.ctx.log.debug('page older than requested window, stopping pagination', { keyword, page });
        break;
      }
      if (keywordCount >= maxPerKeyword) break;
    }
  };

  const active = states.filter((s) => !s.dead);
  await Promise.all([...probes, ...active.flatMap((s) => terms.map((t) => searchTask(s, t)))]);

  // ------------------------------------------------------------ normalize + detail phase
  const now = new Date();
  const normOpts: NormalizeOptions = {
    terms,
    hoursOld,
    remoteOnly: req.remoteOnly,
    includeUndated,
    excludeRepostAggregators: config.excludeRepostAggregators,
    excludeIndeed: config.excludeIndeed,
    now,
    sourceName,
  };

  const needsDetail = (job: NormalizedJob): boolean => {
    const r = job.rejection;
    if (!r) return !job.detail_fetched && (job.description_is_snippet || !job.description_text);
    if (r.code === 'indeed' || r.code === 'invalid') return false;
    if (r.code === 'non_us' && job.location) return false;
    if (r.code === 'too_old' && job.date_confidence !== 'unknown') return false;
    if (r.code === 'irrelevant') return titleLooksRelevant(job.title, terms);
    if (r.code === 'not_remote') return job.remote_type === 'unclear' || (job.remote_type === 'onsite' && job.remote_confidence <= 0.5);
    return true;
  };

  await Promise.all(
    states.map(async (s) => {
      s.report.unique = s.raw.size;
      if (!fetchDetails || !s.adapter.fetchDetails || s.raw.size === 0 || s.dead?.category === 'BLOCKED' || config.maxDetailsPerSource === 0) return;
      const candidates = [...s.raw.values()]
        .map((raw) => ({ raw, norm: normalizeJob(raw, normOpts) }))
        .filter((c) => needsDetail(c.norm))
        .sort((a, b) => (a.norm.age_hours ?? 1e9) - (b.norm.age_hours ?? 1e9) || b.norm.keyword_confidence - a.norm.keyword_confidence)
        .slice(0, config.maxDetailsPerSource);
      if (candidates.length === 0) return;
      s.ctx.log.info('fetching job details', { candidates: candidates.length, listings: s.raw.size });

      await mapPool(candidates, Math.max(1, s.adapter.meta.concurrency), async ({ raw }) => {
        if (signal.aborted || s.detailFailures >= 5 || s.dead?.category === 'BLOCKED') return;
        const key = raw.sourceJobId ?? raw.jobUrl;
        const cacheKey = `${s.id}:${key}`;
        let details = app.repo?.getDetail<Partial<RawJob>>(cacheKey) ?? null;
        if (!details) {
          const releaseGlobal = await globalSem.acquire();
          try {
            details = await s.adapter.fetchDetails!(raw, s.ctx);
            s.report.detailsFetched++;
            if (details) app.repo?.setDetail(cacheKey, details, config.detailCacheTtlHours);
            s.detailFailures = 0;
          } catch (err) {
            const e = toSourceError(err);
            if (e.category !== 'ABORTED' && e.category !== 'NOT_FOUND') {
              s.detailFailures++;
              s.report.errors.push({ category: e.category, message: `detail: ${e.message}` });
              if (e.category === 'RATE_LIMITED' || e.category === 'BLOCKED') s.detailFailures = Math.max(s.detailFailures, 5);
              if (s.detailFailures >= 5) s.ctx.log.warn('detail fetching paused for this source after repeated failures', { category: e.category });
            }
          } finally {
            releaseGlobal();
          }
        }
        if (details) s.raw.set(key, mergeDetails(raw, details));
      });
    }),
  );

  // ------------------------------------------------------------ classify everything
  let normalized: NormalizedJob[] = [];
  for (const s of states) {
    for (const raw of s.raw.values()) {
      try {
        normalized.push(normalizeJob(raw, normOpts));
      } catch (err) {
        s.report.errors.push({ category: 'PARSING_ERROR', message: `normalize: ${(err as Error).message}` });
      }
    }
  }

  // ------------------------------------------------------------ link validation (optional)
  const linkHttp = new SourceHttp(app.http);
  await validateLinks(normalized, { mode: config.validateUrls, max: config.maxUrlValidations, http: linkHttp, log: logger.child('Links'), signal, excludeIndeed: config.excludeIndeed });

  // ------------------------------------------------------------ strict final filter
  const finalParams = { hoursOld, remoteOnly: req.remoteOnly, includeUndated, excludeIndeed: config.excludeIndeed };
  for (const job of normalized) {
    if (job.rejection) continue;
    const verdict = isValidFinalJob(job, finalParams);
    if (!verdict.ok) {
      job.rejection = { code: 'invalid', detail: `final filter: ${verdict.reasons.join('; ')}` };
      logger.child('FinalFilter').warn('rejected a job that passed classification', { source: job.source, title: job.title, reasons: verdict.reasons.join('; ') });
    }
  }

  const accepted = normalized.filter((j) => !j.rejection);
  const rejected = normalized.filter((j) => j.rejection);

  // Per-source counts.
  const byId = new Map(states.map((s) => [s.id, s]));
  const acceptedViaIndeed = new Map<SourceId, number>();
  for (const j of normalized) {
    const s = byId.get(j.source_id)!;
    if (j.rejection) s.report.rejected[j.rejection.code] = (s.report.rejected[j.rejection.code] ?? 0) + 1;
    else {
      s.report.accepted++;
      if (j.via_indeed) acceptedViaIndeed.set(s.id, (acceptedViaIndeed.get(s.id) ?? 0) + 1);
    }
  }
  for (const s of states) {
    if (s.report.unique > 0) {
      const rj = s.report.rejected;
      const indeedPart = config.excludeIndeed ? `rejected_indeed=${rj.indeed ?? 0}` : `accepted_via_indeed=${acceptedViaIndeed.get(s.id) ?? 0}`;
      s.ctx.log.info(
        `accepted=${s.report.accepted} ${indeedPart} rejected_irrelevant=${rj.irrelevant ?? 0} rejected_non_us=${rj.non_us ?? 0} rejected_non_remote=${rj.not_remote ?? 0} rejected_old=${rj.too_old ?? 0} rejected_other=${(rj.invalid ?? 0) + (rj.low_quality ?? 0)}`,
      );
    }
  }

  // ------------------------------------------------------------ dedup + rank
  const { unique, duplicates } = deduplicate(accepted);
  logger.child('Dedup').info(`${accepted.length} accepted jobs => ${unique.length} unique jobs`, { duplicates: duplicates.length });
  let jobs = rankJobs(unique);

  // ------------------------------------------------------------ reports
  const timedOut = timeoutSignal.aborted;
  for (const s of states) {
    s.report.requests = s.ctx.http.requests;
    s.report.durationMs = Date.now() - s.started;
    if (s.report.status !== 'SKIPPED' && s.report.status !== 'BLOCKED') s.report.status = statusOf(s);
    if (s.dead && !s.report.note) s.report.note = `${s.dead.category}: ${s.dead.message}`;
    if (timedOut && !s.report.note) s.report.note = 'run timeout reached; results may be partial';
  }
  const reports = states.map((s) => s.report);

  const count = (code: RejectionReason['code']) => rejected.filter((j) => j.rejection!.code === code).length;
  const metrics: RunMetrics = {
    search_keywords: terms.length,
    sources_requested: sourceIds.length,
    raw_listings: rawListings,
    unique_listings: normalized.length,
    removed_indeed: count('indeed'),
    removed_invalid: count('invalid'),
    removed_low_quality: count('low_quality'),
    removed_irrelevant: count('irrelevant'),
    removed_non_us: count('non_us'),
    removed_not_remote: count('not_remote'),
    removed_too_old: count('too_old'),
    removed_duplicates: duplicates.length,
    final_unique_jobs: jobs.length,
    indeed_jobs: jobs.filter((j) => j.via_indeed).length,
  };

  if (persist) {
    try {
      app.repo!.upsertJobs(jobs, duplicates, runId, now);
    } catch (err) {
      log.error('failed to persist jobs', { error: (err as Error).message });
    }
  }

  const attempted = reports.filter((r) => r.status !== 'SKIPPED');
  const summary: SearchSummary = {
    sources_attempted: attempted.length,
    sources_succeeded: reports.filter((r) => r.status === 'OK' || r.status === 'PARTIAL').length,
    sources_failed: reports.filter((r) => r.status === 'ERROR' || r.status === 'BLOCKED').length,
    sources_skipped: reports.filter((r) => r.status === 'SKIPPED').length,
    raw_jobs_found: rawListings,
    remote_us_jobs: accepted.length,
    deduplicated_jobs: jobs.length,
    new_jobs: jobs.filter((j) => j.is_new).length,
    duration_ms: Date.now() - started,
    timed_out: timedOut,
  };

  if (persist) {
    try {
      app.repo!.saveSourceStatuses(runId, reports);
      app.repo!.finishRun(runId, timedOut ? 'timed_out' : 'completed', summary, metrics);
    } catch (err) {
      log.error('failed to persist run report', { error: (err as Error).message });
    }
  }

  logger.raw('\n' + formatSourceReport(reports) + '\n');
  logger.raw(formatMetrics(metrics, hoursOld) + '\n');
  log.info('run finished', { run: runId, summary: formatSummaryLine(summary) });

  const result: SearchResult = {
    run_id: runId,
    query,
    summary,
    metrics,
    sources: reports,
    jobs: req.includeDuplicates ? [...jobs, ...duplicates] : jobs,
  };
  if (req.includeRejected) result.rejected = rejected;
  return result;
}
