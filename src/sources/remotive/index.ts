import { looseKeywordMatch } from '../shared/keywordFilter.ts';
import type { SourceAdapter } from '../types.ts';
import { parseRemotive, type RemotiveResponse } from './parse.ts';

const API_URL = 'https://remotive.com/api/remote-jobs';

export const remotive: SourceAdapter = {
  meta: {
    id: 'remotive',
    name: 'Remotive',
    method: 'api',
    methodDetail: 'Official public JSON API (https://remotive.com/api/remote-jobs) — full feed fetched once per run, filtered locally',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://remotive.com',
    notes: 'Remotive asks API users to link back and not to hammer the API, so the feed is cached for at least an hour. Healthcare-admin roles are rare on this board.',
    hostPolicies: { 'remotive.com': { concurrency: 1, minIntervalMs: 3_000, jitterMs: 500 } },
    concurrency: 4,
    supportsDetails: false,
    maxPages: 1,
  },

  async searchJobs(q, ctx) {
    const { data, res } = await ctx.http.getJson<RemotiveResponse>(API_URL, { signal: ctx.signal, cacheTtlMs: Math.max(ctx.config.searchCacheTtlMs, 60 * 60_000), timeoutMs: 60_000 });
    const all = parseRemotive(data, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: API_URL });
    const jobs = all.filter((j) => looseKeywordMatch(q.keyword, j.title, j.tags, j.descriptionHtml));
    return { jobs, hasMore: false, requestUrl: API_URL, total: all.length };
  },

  async probe(ctx) {
    const { data, res } = await ctx.http.getJson<RemotiveResponse>(`${API_URL}?limit=1`, { signal: ctx.signal, retries: 0 });
    return { ok: Array.isArray(data.jobs), message: `API reachable (job-count ${data['job-count'] ?? 'n/a'})`, httpStatus: res.status };
  },
};
