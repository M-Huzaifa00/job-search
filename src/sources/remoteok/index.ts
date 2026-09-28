import { looseKeywordMatch } from '../shared/keywordFilter.ts';
import type { SourceAdapter } from '../types.ts';
import { parseRemoteOk, type RemoteOkItem } from './parse.ts';

const API_URL = 'https://remoteok.com/api';

export const remoteok: SourceAdapter = {
  meta: {
    id: 'remoteok',
    name: 'RemoteOK',
    method: 'api',
    methodDetail: 'Official public JSON API (https://remoteok.com/api) — one request per run, filtered locally',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://remoteok.com',
    notes: 'API terms require linking back to the RemoteOK listing; job_url always points to remoteok.com. The feed holds only the latest ~100 jobs and few are healthcare-admin roles.',
    hostPolicies: { 'remoteok.com': { concurrency: 1, minIntervalMs: 2_000, jitterMs: 500 } },
    concurrency: 4,
    supportsDetails: false,
    maxPages: 1,
  },

  async searchJobs(q, ctx) {
    const { data, res } = await ctx.http.getJson<RemoteOkItem[]>(API_URL, { signal: ctx.signal, cacheTtlMs: Math.max(ctx.config.searchCacheTtlMs, 30 * 60_000) });
    const all = parseRemoteOk(Array.isArray(data) ? data : [], { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: API_URL });
    const jobs = all.filter((j) => looseKeywordMatch(q.keyword, j.title, j.tags, j.descriptionHtml));
    return { jobs, hasMore: false, requestUrl: API_URL, total: all.length };
  },

  async probe(ctx) {
    const { data, res } = await ctx.http.getJson<unknown[]>(API_URL, { signal: ctx.signal, retries: 0 });
    return { ok: Array.isArray(data) && data.length > 1, message: `feed returned ${Array.isArray(data) ? data.length - 1 : 0} jobs`, httpStatus: res.status };
  },
};
