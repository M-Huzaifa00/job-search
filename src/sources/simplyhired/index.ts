import type { RawJob } from '../../models/job.ts';
import { SourceError } from '../../http/errors.ts';
import type { SourceAdapter } from '../types.ts';
import { parseSimplyHiredDetail, parseSimplyHiredSearch, simplyHiredDetailToRaw, simplyHiredJobToRaw } from './parse.ts';

/** Cursor for page N of a keyword, captured from page N-1 (SimplyHired paginates with opaque cursors). */
const cursors = new Map<string, string>();

function daysFilter(hoursOld: number): string {
  const days = Math.ceil(hoursOld / 24);
  for (const allowed of [1, 3, 7, 14, 30]) if (days <= allowed) return String(allowed);
  return '30';
}

export const simplyhired: SourceAdapter = {
  meta: {
    id: 'simplyhired',
    name: 'SimplyHired',
    method: 'http-html',
    methodDetail: 'Server-rendered Next.js data (__NEXT_DATA__) on search and job pages',
    status: 'restricted',
    // Runs by default once ALLOW_INDEED_NETWORK_SOURCES=true; until then unavailableReason skips it.
    defaultEnabled: true,
    homepage: 'https://www.simplyhired.com',
    notes:
      'SimplyHired states it "is part of the Indeed Site" and its listings come from Indeed\'s index (records carry dateOnIndeed / indeedApply). Because Indeed must be excluded, this source only runs when ALLOW_INDEED_NETWORK_SOURCES=true, and even then every listing that applies through Indeed is rejected.',
    requirement: 'Set ALLOW_INDEED_NETWORK_SOURCES=true to opt in.',
    hostPolicies: { 'www.simplyhired.com': { concurrency: 1, minIntervalMs: 1_500, jitterMs: 800 } },
    concurrency: 1,
    supportsDetails: true,
  },

  unavailableReason(config) {
    return config.allowIndeedNetworkSources ? null : { category: 'UNSUPPORTED', message: 'disabled by policy: SimplyHired is operated by Indeed (set ALLOW_INDEED_NETWORK_SOURCES=true to opt in)' };
  },

  manualSearch({ keyword, hoursOld, remoteOnly }) {
    const days = daysFilter(hoursOld);
    const params = new URLSearchParams({ q: keyword, l: 'United States', t: days });
    if (remoteOnly) params.set('wl', 'remote');
    return { url: `https://www.simplyhired.com/search?${params}`, filters: [...(remoteOnly ? ['remote'] : []), 'US', days === '1' ? 'last 24h' : `last ${days} days`] };
  },

  async searchJobs(q, ctx) {
    const params = new URLSearchParams({ q: q.keyword, l: 'United States', t: daysFilter(q.hoursOld) });
    if (q.remoteOnly) params.set('wl', 'remote');
    if (q.page > 1) {
      const cursor = cursors.get(`${q.keyword}|${q.page}`);
      if (!cursor) return { jobs: [], hasMore: false };
      params.set('cursor', cursor);
    }
    const url = `https://www.simplyhired.com/search?${params}`;
    const res = await ctx.http.getText(url, { signal: ctx.signal });
    const data = parseSimplyHiredSearch(res.text);
    const next = data.pageCursors[String(q.page + 1)];
    if (next) cursors.set(`${q.keyword}|${q.page + 1}`, next);
    const jobs = data.jobs.filter((j) => j.jobKey && j.title).map((j) => simplyHiredJobToRaw(j, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: url, remoteFiltered: q.remoteOnly }));
    return { jobs, hasMore: !!next && jobs.length > 0, requestUrl: url, total: data.resultCount };
  },

  async probe(ctx) {
    const res = await ctx.http.getText('https://www.simplyhired.com/search?q=medical+billing&l=United+States&wl=remote', { signal: ctx.signal, retries: 0 });
    const n = parseSimplyHiredSearch(res.text).jobs.length;
    return { ok: n > 0, message: `search returned ${n} jobs`, httpStatus: res.status };
  },

  async fetchDetails(job, ctx): Promise<Partial<RawJob> | null> {
    const res = await ctx.http.getText(job.jobUrl, { signal: ctx.signal, retries: 1 });
    const d = parseSimplyHiredDetail(res.text);
    if (!d) throw new SourceError('PARSING_ERROR', 'SimplyHired job page has no job data');
    return simplyHiredDetailToRaw(d, job);
  },
};
