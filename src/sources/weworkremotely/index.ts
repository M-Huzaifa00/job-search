import type { RawJob } from '../../models/job.ts';
import { looseKeywordMatch } from '../shared/keywordFilter.ts';
import type { SourceAdapter, SourceContext } from '../types.ts';
import { parseWeWorkRemotely } from './parse.ts';

const BASE = 'https://weworkremotely.com';
/** The all-jobs feed plus the categories where healthcare-admin roles are posted. */
const FEEDS = [
  `${BASE}/remote-jobs.rss`,
  `${BASE}/categories/remote-customer-support-jobs.rss`,
  `${BASE}/categories/remote-management-and-finance-jobs.rss`,
  `${BASE}/categories/all-other-remote-jobs.rss`,
];

async function loadFeeds(ctx: SourceContext, keyword: string): Promise<RawJob[]> {
  const byId = new Map<string, RawJob>();
  for (const url of FEEDS) {
    // Cached for the run, so every keyword after the first reuses the same four responses.
    const res = await ctx.http.getText(url, {
      signal: ctx.signal,
      timeoutMs: 60_000,
      cacheTtlMs: Math.max(ctx.config.searchCacheTtlMs, 60 * 60_000),
      headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
    });
    for (const job of parseWeWorkRemotely(res.text, { fetchedAt: res.fetchedAt, keyword, sourceUrl: url })) byId.set(job.sourceJobId ?? job.jobUrl, job);
  }
  return [...byId.values()];
}

export const weworkremotely: SourceAdapter = {
  meta: {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    method: 'rss',
    methodDetail: 'Public RSS feeds (all jobs + customer support, management & finance, all other categories), fetched once per run and filtered locally',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://weworkremotely.com',
    notes:
      'Remote-only board focused on tech; medical-admin roles are rare. The RSS feeds are published for readers; the website and its search pages are behind a Cloudflare challenge and are not used.',
    hostPolicies: { 'weworkremotely.com': { concurrency: 1, minIntervalMs: 2_000, jitterMs: 500 } },
    concurrency: 4,
    supportsDetails: false,
    maxPages: 1,
  },

  async searchJobs(q, ctx) {
    const all = await loadFeeds(ctx, q.keyword);
    const jobs = all.filter((j) => looseKeywordMatch(q.keyword, j.title, j.tags, j.descriptionHtml));
    return { jobs, hasMore: false, requestUrl: FEEDS[0], total: all.length };
  },

  async probe(ctx) {
    const res = await ctx.http.getText(FEEDS[0], { signal: ctx.signal, retries: 0, timeoutMs: 60_000 });
    const n = parseWeWorkRemotely(res.text, { fetchedAt: res.fetchedAt, keyword: '', sourceUrl: FEEDS[0] }).length;
    return { ok: n > 0, message: `RSS feed returned ${n} jobs`, httpStatus: res.status };
  },
};
