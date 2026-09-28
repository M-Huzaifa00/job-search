import { SourceError, toSourceError } from '../http/errors.ts';
import type { SourceId } from '../models/job.ts';
import type { SourceAdapter } from './types.ts';

interface BlockedSpec {
  id: SourceId;
  name: string;
  homepage: string;
  /** What was attempted when the integration was built. */
  attempted: string;
  /** What the platform returned. */
  observed: string;
  requirement: string;
  probeUrl: string;
}

/**
 * Adapter for platforms that answer automated requests with bot challenges / CAPTCHAs.
 * Solving or evading those challenges is out of scope, so the adapter never returns jobs: when a
 * run explicitly requests it, it performs one probe request and reports the current status.
 */
function blockedSource(spec: BlockedSpec): SourceAdapter {
  const host = new URL(spec.probeUrl).host;
  return {
    meta: {
      id: spec.id,
      name: spec.name,
      method: 'probe-only',
      methodDetail: `Attempted: ${spec.attempted}`,
      status: 'blocked',
      defaultEnabled: false,
      homepage: spec.homepage,
      notes: `Observed: ${spec.observed}`,
      requirement: spec.requirement,
      hostPolicies: { [host]: { concurrency: 1, minIntervalMs: 2_000, jitterMs: 500 } },
      concurrency: 1,
      supportsDetails: false,
      maxPages: 1,
    },
    unavailableReason: () => ({ category: 'BLOCKED', message: spec.observed }),
    async searchJobs() {
      throw new SourceError('BLOCKED', spec.observed);
    },
    async probe(ctx) {
      try {
        const res = await ctx.http.getText(spec.probeUrl, { signal: ctx.signal, retries: 0 });
        return {
          ok: false,
          category: 'UNSUPPORTED',
          httpStatus: res.status,
          message: `reachable right now (HTTP ${res.status}) but no parser is implemented because the site served bot challenges when this integration was built`,
        };
      } catch (err) {
        const e = toSourceError(err);
        return { ok: false, category: e.category, httpStatus: e.status, message: e.message };
      }
    },
  };
}

export const ziprecruiter = blockedSource({
  id: 'ziprecruiter',
  name: 'ZipRecruiter',
  homepage: 'https://www.ziprecruiter.com',
  attempted: 'HTTP GET of the public search page (/jobs-search?search=...&location=Remote (USA))',
  observed: 'Cloudflare managed challenge ("Just a moment...", HTTP 403) on every search request',
  requirement: 'ZipRecruiter publisher/partner API credentials or a licensed job feed.',
  probeUrl: 'https://www.ziprecruiter.com/jobs-search?search=medical+billing&location=Remote+%28USA%29',
});

export const glassdoor = blockedSource({
  id: 'glassdoor',
  name: 'Glassdoor',
  homepage: 'https://www.glassdoor.com',
  attempted: 'HTTP GET of the public job search page (/Job/...-jobs-SRCH_...htm)',
  observed: 'HTTP 403 "Security | Glassdoor" bot-check page (Cloudflare)',
  requirement: 'Glassdoor retired its public API; a data partnership / licensed feed is required.',
  probeUrl: 'https://www.glassdoor.com/Job/united-states-medical-billing-jobs-SRCH_IL.0,13_IN1_KO14,29.htm',
});

export const careerbuilder = blockedSource({
  id: 'careerbuilder',
  name: 'CareerBuilder',
  homepage: 'https://www.careerbuilder.com',
  attempted: 'HTTP GET of /jobs (redirects to the homepage) and /job-listings/search (server HTML contains no results)',
  observed:
    'Results are loaded client-side from the shared Monster/CareerBuilder jobs API (appsapi.monster.io jobs-svx-service), which answers with a DataDome CAPTCHA interstitial (HTTP 403)',
  requirement: 'A partner/API agreement with Monster-CareerBuilder, or a licensed job feed.',
  probeUrl: 'https://www.careerbuilder.com/job-listings/search?q=medical+billing&where=remote',
});

export const monster = blockedSource({
  id: 'monster',
  name: 'Monster',
  homepage: 'https://www.monster.com',
  attempted: 'HTTP GET of /jobs/search (server HTML has an empty result list) and the page\'s own search API',
  observed: 'The search API (appsapi.monster.io jobs-svx-service) is protected by DataDome and returns a CAPTCHA interstitial (HTTP 403)',
  requirement: 'A partner/API agreement with Monster, or a licensed job feed.',
  probeUrl: 'https://appsapi.monster.io/jobs-svx-service/v2/monster/search-jobs/samsearch/en-US',
});

export const wellfound = blockedSource({
  id: 'wellfound',
  name: 'Wellfound',
  homepage: 'https://wellfound.com',
  attempted: 'HTTP GET of public role/remote listing pages',
  observed: 'Redirects to a page gated by a Cloudflare Turnstile challenge before any job data is served',
  requirement: 'Wellfound has no public jobs API; partner access would be required.',
  probeUrl: 'https://wellfound.com/role/r/medical-billing',
});

export const builtin = blockedSource({
  id: 'builtin',
  name: 'Built In',
  homepage: 'https://builtin.com',
  attempted: 'HTTP GET of the public remote job search (/jobs/remote?search=...)',
  observed: 'Cloudflare "Attention Required!" block page (HTTP 403)',
  requirement: 'Built In has no public jobs API; a partner feed would be required.',
  probeUrl: 'https://builtin.com/jobs/remote?search=medical+billing',
});
