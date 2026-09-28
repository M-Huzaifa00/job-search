import { SourceError, toSourceError } from '../http/errors.ts';
import type { SourceId } from '../models/job.ts';
import type { ManualSearchLink, ManualSearchQuery, SourceAdapter } from './types.ts';

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
  /** Search link for a person to open in their own browser (see SourceAdapter.manualSearch). */
  manualSearch(q: ManualSearchQuery): ManualSearchLink;
}

/**
 * Adapter for platforms that answer automated requests with bot challenges / CAPTCHAs.
 * Solving or evading those challenges is out of scope, so the adapter never returns jobs: when a
 * run explicitly requests it, it performs one probe request and reports the current status, and it
 * can build a pre-filtered search link for manual review.
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
    manualSearch: spec.manualSearch,
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

/** Smallest "posted within N days" option a site offers that covers hoursOld (null = wider than all options). */
export function dayBucket(hoursOld: number, options: number[]): number | null {
  const days = Math.max(1, Math.ceil(hoursOld / 24));
  return options.find((d) => d >= days) ?? null;
}

function ageLabel(days: number): string {
  return days === 1 ? 'last 24h' : `last ${days} days`;
}

function slug(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const ziprecruiter = blockedSource({
  id: 'ziprecruiter',
  name: 'ZipRecruiter',
  homepage: 'https://www.ziprecruiter.com',
  attempted: 'HTTP GET of the public search page (/jobs-search?search=...&location=Remote (USA))',
  observed: 'Cloudflare managed challenge ("Just a moment...", HTTP 403) on every search request',
  requirement: 'ZipRecruiter publisher/partner API credentials or a licensed job feed.',
  probeUrl: 'https://www.ziprecruiter.com/jobs-search?search=medical+billing&location=Remote+%28USA%29',
  manualSearch({ keyword, hoursOld, remoteOnly }) {
    const p = new URLSearchParams({ search: keyword, location: remoteOnly ? 'Remote (USA)' : 'United States' });
    const filters = [remoteOnly ? 'remote' : 'US'];
    if (remoteOnly) p.set('refine_by_location_type', 'only_remote');
    const days = dayBucket(hoursOld, [1, 5, 10, 30]);
    if (days) {
      p.set('days', String(days));
      filters.push(ageLabel(days));
    }
    return { url: `https://www.ziprecruiter.com/jobs-search?${p}`, filters };
  },
});

export const glassdoor = blockedSource({
  id: 'glassdoor',
  name: 'Glassdoor',
  homepage: 'https://www.glassdoor.com',
  attempted: 'HTTP GET of the public job search page (/Job/...-jobs-SRCH_...htm)',
  observed: 'HTTP 403 "Security | Glassdoor" bot-check page (Cloudflare)',
  requirement: 'Glassdoor retired its public API; a data partnership / licensed feed is required.',
  probeUrl: 'https://www.glassdoor.com/Job/united-states-medical-billing-jobs-SRCH_IL.0,13_IN1_KO14,29.htm',
  manualSearch({ keyword, hoursOld, remoteOnly }) {
    // locT=N&locId=1 is Glassdoor's id for the United States.
    const p = new URLSearchParams({ 'sc.keyword': keyword, locT: 'N', locId: '1' });
    const filters = ['US'];
    if (remoteOnly) {
      p.set('remoteWorkType', '1');
      filters.push('remote');
    }
    const days = dayBucket(hoursOld, [1, 3, 7, 14, 30]);
    if (days) {
      p.set('fromAge', String(days));
      filters.push(ageLabel(days));
    }
    return { url: `https://www.glassdoor.com/Job/jobs.htm?${p}`, filters };
  },
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
  manualSearch({ keyword, remoteOnly }) {
    const p = new URLSearchParams({ q: keyword, where: remoteOnly ? 'remote' : 'United States' });
    return { url: `https://www.careerbuilder.com/job-listings/search?${p}`, filters: [remoteOnly ? 'remote' : 'US'] };
  },
});

export const monster = blockedSource({
  id: 'monster',
  name: 'Monster',
  homepage: 'https://www.monster.com',
  attempted: 'HTTP GET of /jobs/search (server HTML has an empty result list) and the page\'s own search API',
  observed: 'The search API (appsapi.monster.io jobs-svx-service) is protected by DataDome and returns a CAPTCHA interstitial (HTTP 403)',
  requirement: 'A partner/API agreement with Monster, or a licensed job feed.',
  probeUrl: 'https://appsapi.monster.io/jobs-svx-service/v2/monster/search-jobs/samsearch/en-US',
  manualSearch({ keyword, remoteOnly }) {
    const p = new URLSearchParams({ q: keyword, where: remoteOnly ? 'remote' : 'United States' });
    return { url: `https://www.monster.com/jobs/search?${p}`, filters: [remoteOnly ? 'remote' : 'US'] };
  },
});

export const wellfound = blockedSource({
  id: 'wellfound',
  name: 'Wellfound',
  homepage: 'https://wellfound.com',
  attempted: 'HTTP GET of public role/remote listing pages',
  observed: 'Redirects to a page gated by a Cloudflare Turnstile challenge before any job data is served',
  requirement: 'Wellfound has no public jobs API; partner access would be required.',
  probeUrl: 'https://wellfound.com/role/r/medical-billing',
  manualSearch({ keyword, remoteOnly }) {
    // Wellfound only has pages for its own role names; unknown roles fall back to its role list.
    return remoteOnly
      ? { url: `https://wellfound.com/role/r/${slug(keyword)}`, filters: ['remote'] }
      : { url: `https://wellfound.com/role/${slug(keyword)}`, filters: [] };
  },
});

export const flexjobs = blockedSource({
  id: 'flexjobs',
  name: 'FlexJobs',
  homepage: 'https://www.flexjobs.com',
  attempted: 'HTTP GET of the public search (/search?search=...) and remote category pages (/remote-jobs/...)',
  observed: 'Akamai edge block ("Access Denied", HTTP 403, errors.edgesuite.net reference) on every page',
  requirement: 'FlexJobs is a paid-membership board with no public API (employer names and apply links are members-only); a partner feed would be required.',
  probeUrl: 'https://www.flexjobs.com/search?search=medical+billing',
  manualSearch({ keyword }) {
    const p = new URLSearchParams({ search: keyword, location: 'United States' });
    return { url: `https://www.flexjobs.com/search?${p}`, filters: ['US'] };
  },
});

export const indeed = blockedSource({
  id: 'indeed',
  name: 'Indeed',
  homepage: 'https://www.indeed.com',
  attempted: 'HTTP GET of the public search (/jobs?q=...&l=Remote) and the retired RSS feed (rss.indeed.com)',
  observed: 'Cloudflare "Security Check - Indeed.com" page (HTTP 403); the RSS feed returns 404. Indeed is also excluded from this aggregator by design',
  requirement: 'Excluded by policy. Indeed offers no public job-search API; only its partner/publisher programs provide feeds.',
  probeUrl: 'https://www.indeed.com/jobs?q=medical+billing&l=Remote',
  manualSearch({ keyword, hoursOld, remoteOnly }) {
    const p = new URLSearchParams({ q: keyword, l: remoteOnly ? 'Remote' : 'United States', sort: 'date' });
    const filters = [remoteOnly ? 'remote' : 'US'];
    const days = dayBucket(hoursOld, [1, 3, 7, 14]);
    if (days) {
      p.set('fromage', String(days));
      filters.push(ageLabel(days));
    }
    return { url: `https://www.indeed.com/jobs?${p}`, filters };
  },
});

export const builtin = blockedSource({
  id: 'builtin',
  name: 'Built In',
  homepage: 'https://builtin.com',
  attempted: 'HTTP GET of the public remote job search (/jobs/remote?search=...)',
  observed: 'Cloudflare "Attention Required!" block page (HTTP 403)',
  requirement: 'Built In has no public jobs API; a partner feed would be required.',
  probeUrl: 'https://builtin.com/jobs/remote?search=medical+billing',
  manualSearch({ keyword, remoteOnly }) {
    const p = new URLSearchParams({ search: keyword });
    return remoteOnly ? { url: `https://builtin.com/jobs/remote?${p}`, filters: ['remote'] } : { url: `https://builtin.com/jobs?${p}`, filters: [] };
  },
});
