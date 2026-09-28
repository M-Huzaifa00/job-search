import type { SourceAdapter } from '../types.ts';
import { parseJobBankFeed } from './parse.ts';

const FEED_URL = 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed';

export const canadaJobBank: SourceAdapter = {
  meta: {
    id: 'canada_job_bank',
    name: 'Canada Job Bank',
    method: 'rss',
    methodDetail: 'Official Government of Canada Atom feed (jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed), newest first',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://www.jobbank.gc.ca',
    notes:
      'Integration works, but Job Bank only lists jobs located in Canada, so its listings are expected to be rejected by the US-eligibility filter unless a posting explicitly opens the role to US residents.',
    hostPolicies: { 'www.jobbank.gc.ca': { concurrency: 2, minIntervalMs: 1_000, jitterMs: 500 } },
    concurrency: 2,
    supportsDetails: false,
    maxPages: 1,
  },

  async searchJobs(q, ctx) {
    const params = new URLSearchParams({ searchstring: q.keyword, sort: 'D', rows: String(Math.min(100, Math.max(25, q.maxResults))) });
    const url = `${FEED_URL}?${params}`;
    const res = await ctx.http.getText(url, { signal: ctx.signal, headers: { accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.5' }, cacheTtlMs: ctx.config.searchCacheTtlMs, timeoutMs: 45_000 });
    const jobs = parseJobBankFeed(res.text, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: url });
    return { jobs, hasMore: false, requestUrl: url };
  },

  async probe(ctx) {
    const res = await ctx.http.getText(`${FEED_URL}?searchstring=medical+billing&sort=D&rows=5`, { signal: ctx.signal, retries: 0, timeoutMs: 45_000 });
    const n = parseJobBankFeed(res.text, { fetchedAt: res.fetchedAt, keyword: 'probe', sourceUrl: '' }).length;
    return { ok: res.text.includes('<feed'), message: `feed returned ${n} entries`, httpStatus: res.status };
  },
};
