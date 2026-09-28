import type { SourceHttp } from '../http/client.ts';
import { toSourceError } from '../http/errors.ts';
import type { NormalizedJob } from '../models/job.ts';
import { canonicalizeUrl, isJobBoardUrl, isRedirectTracker, stripTracking } from '../core/normalization/url.ts';
import { resolveRedirects } from '../sources/shared/redirects.ts';
import { mapPool } from '../utils/concurrency.ts';
import type { Logger } from '../utils/logger.ts';

export interface LinkValidationStats {
  checked: number;
  indeed: number;
  broken: number;
  errors: number;
}

/**
 * Resolves application URLs of accepted jobs. `redirects` mode only follows aggregator click-trackers
 * (the ones that could hide an Indeed destination); `all` also checks employer URLs for 404s.
 * Only URLs that came from job sources are followed — never user input.
 */
export async function validateLinks(
  jobs: NormalizedJob[],
  opts: { mode: 'off' | 'redirects' | 'all'; max: number; http: SourceHttp; log: Logger; signal: AbortSignal; excludeIndeed?: boolean },
): Promise<LinkValidationStats> {
  const stats: LinkValidationStats = { checked: 0, indeed: 0, broken: 0, errors: 0 };
  if (opts.mode === 'off') return stats;

  const targets = jobs.filter((j) => {
    if (j.rejection) return false;
    const url = j.apply_url ?? j.job_url;
    if (isRedirectTracker(url)) return true;
    return opts.mode === 'all' && !!j.apply_url && !isJobBoardUrl(j.apply_url);
  });

  await mapPool(targets.slice(0, opts.max), 4, async (job) => {
    if (opts.signal.aborted) return;
    const url = job.apply_url ?? job.job_url;
    try {
      const r = await resolveRedirects(opts.http, url, { signal: opts.signal });
      stats.checked++;
      if (r.viaIndeed) {
        stats.indeed++;
        job.via_indeed = true;
        if (opts.excludeIndeed ?? true) {
          job.rejection = { code: 'indeed', detail: `application redirects to Indeed (${new URL(r.finalUrl).host})` };
          return;
        }
      }
      if (r.status === 404 || r.status === 410) {
        stats.broken++;
        job.quality_flags.push('broken_apply_url');
        job.rejection = { code: 'low_quality', detail: `application URL returns HTTP ${r.status}` };
        return;
      }
      if (isRedirectTracker(url) && !isJobBoardUrl(r.finalUrl)) {
        job.apply_url = stripTracking(r.finalUrl);
        job.canonical_url = canonicalizeUrl(r.finalUrl);
      }
    } catch (err) {
      stats.errors++;
      opts.log.debug('link validation failed', { url, error: toSourceError(err).message });
    }
  });
  if (stats.checked) opts.log.info('link validation', { ...stats });
  return stats;
}
