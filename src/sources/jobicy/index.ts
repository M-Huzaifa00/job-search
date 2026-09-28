import { looseKeywordMatch } from '../shared/keywordFilter.ts';
import type { SourceAdapter } from '../types.ts';
import { parseJobicy, type JobicyResponse } from './parse.ts';

const API_URL = 'https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa';

export const jobicy: SourceAdapter = {
  meta: {
    id: 'jobicy',
    name: 'Jobicy',
    method: 'api',
    methodDetail: 'Official public JSON API (https://jobicy.com/api/v2/remote-jobs, geo=usa) — one request per run, filtered locally',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://jobicy.com',
    notes: 'The API returns the latest 100 US-eligible remote jobs; Jobicy asks for attribution and a direct link to the original job URL.',
    hostPolicies: { 'jobicy.com': { concurrency: 1, minIntervalMs: 3_000, jitterMs: 500 } },
    concurrency: 4,
    supportsDetails: false,
    maxPages: 1,
  },

  async searchJobs(q, ctx) {
    const { data, res } = await ctx.http.getJson<JobicyResponse>(API_URL, { signal: ctx.signal, cacheTtlMs: Math.max(ctx.config.searchCacheTtlMs, 60 * 60_000), timeoutMs: 60_000 });
    const all = parseJobicy(data, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: API_URL, geoFiltered: true });
    const jobs = all.filter((j) => looseKeywordMatch(q.keyword, j.title, j.tags, j.descriptionHtml ?? j.descriptionText));
    return { jobs, hasMore: false, requestUrl: API_URL, total: all.length };
  },

  async probe(ctx) {
    const { data, res } = await ctx.http.getJson<JobicyResponse>('https://jobicy.com/api/v2/remote-jobs?count=1&geo=usa', { signal: ctx.signal, retries: 0, timeoutMs: 45_000 });
    return { ok: Array.isArray(data.jobs), message: `API reachable (${data.jobs?.length ?? 0} job)`, httpStatus: res.status };
  },
};
