import type { SourceAdapter } from '../types.ts';
import { parseHimalayas, type HimalayasResponse } from './parse.ts';

const SEARCH_URL = 'https://himalayas.app/jobs/api/search';
const PAGE_SIZE = 20;

export const himalayas: SourceAdapter = {
  meta: {
    id: 'himalayas',
    name: 'Himalayas',
    method: 'api',
    methodDetail: 'Free public JSON search API (https://himalayas.app/jobs/api/search, country=US, sort=recent), no authentication',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://himalayas.app',
    notes:
      'Remote-only board. Himalayas publishes this API for other job boards and search tools to use; it caps responses at 20 jobs and refreshes its data daily. The country filter also returns worldwide jobs; each job lists the countries it accepts.',
    hostPolicies: { 'himalayas.app': { concurrency: 1, minIntervalMs: 1_000, jitterMs: 400 } },
    concurrency: 2,
    supportsDetails: false,
  },

  async searchJobs(q, ctx) {
    const params = new URLSearchParams({ q: q.keyword, sort: 'recent', page: String(q.page) });
    params.set('country', 'US');
    const url = `${SEARCH_URL}?${params}`;
    const { data, res } = await ctx.http.getJson<HimalayasResponse>(url, { signal: ctx.signal, cacheTtlMs: ctx.config.searchCacheTtlMs });
    const jobs = parseHimalayas(data, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: url, usFiltered: true });
    const total = data.totalCount;
    const hasMore = jobs.length > 0 && (total === undefined || q.page * PAGE_SIZE < total);
    return { jobs, hasMore, requestUrl: url, total };
  },

  async probe(ctx) {
    const { data, res } = await ctx.http.getJson<HimalayasResponse>(`${SEARCH_URL}?q=medical%20billing&country=US&sort=recent`, { signal: ctx.signal, retries: 0 });
    return { ok: Array.isArray(data.jobs) && data.jobs.length > 0, message: `search API returned ${data.jobs?.length ?? 0} jobs (total ${data.totalCount ?? 'n/a'})`, httpStatus: res.status };
  },
};
