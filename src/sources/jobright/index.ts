import { SourceError } from '../../http/errors.ts';
import type { SourceAdapter, SourceContext } from '../types.ts';
import { jobRightItemToRaw, parseJobRightSearch, type JobRightSearchResponse } from './parse.ts';

const SEARCH_URL = 'https://jobright.ai/swan/recommend/visitor-search';
const PAGE_SIZE = 20;
const WORK_MODEL_REMOTE = 2;
const SORT_MOST_RECENT = 1;

/** JobRight's "Date posted" filter only knows these day buckets; older rows are dropped by the date check. */
function daysAgoFilter(hoursOld: number): number {
  const days = Math.ceil(hoursOld / 24);
  for (const allowed of [1, 3, 7, 30]) if (days <= allowed) return allowed;
  return 30;
}

async function visitorSearch(ctx: SourceContext, keyword: string, opts: { position: number; count: number; remoteOnly: boolean; daysAgo?: number; retries?: number }) {
  const params = new URLSearchParams({
    lite: 'false',
    count: String(opts.count),
    position: String(opts.position),
    searchType: 'job_title',
    sortCondition: String(SORT_MOST_RECENT),
  });
  const url = `${SEARCH_URL}?${params}`;
  // Same condition object the site's own search page posts for a logged-out visitor.
  const body = {
    value: keyword,
    country: 'US',
    jobTaxonomyList: [{ taxonomyId: '00-00-00', title: keyword }],
    locations: [],
    jobTypes: [],
    seniority: [],
    workModel: opts.remoteOnly ? [WORK_MODEL_REMOTE] : [],
    daysAgo: opts.daysAgo,
    searchType: 'job_title',
  };
  const { data, res } = await ctx.http.getJson<JobRightSearchResponse>(url, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: ctx.signal,
    retries: opts.retries,
    cacheTtlMs: ctx.config.searchCacheTtlMs,
    headers: { 'content-type': 'application/json', origin: 'https://jobright.ai', referer: 'https://jobright.ai/jobs/healthcare' },
  });
  if (res.url.includes('/security/challenge')) throw new SourceError('BLOCKED', 'JobRight security check page', { url });
  if (!data.success) throw new SourceError('HTTP_ERROR', `JobRight API error: ${data.errorMsg ?? 'unknown'}`, { url });
  return { data, res, url, body };
}

export const jobright: SourceAdapter = {
  meta: {
    id: 'jobright',
    name: 'JobRight',
    method: 'http-json',
    methodDetail: 'Logged-out visitor search API used by jobright.ai itself (POST /swan/recommend/visitor-search) with work model Remote, country US and "date posted" filters',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://jobright.ai',
    notes:
      'Server-side filters: US, Remote, posted within 1/3/7/30 days. Descriptions are JobRight\'s AI summaries (summary, responsibilities, requirements), not the original posting. The employer apply link is only shown to logged-in users, and many listings are cross-posted from LinkedIn (duplicates are merged). The search page itself (/jobs/search) is behind a bot check; the API is not.',
    hostPolicies: { 'jobright.ai': { concurrency: 2, minIntervalMs: 1_200, jitterMs: 600 } },
    concurrency: 2,
    supportsDetails: false,
  },

  async searchJobs(q, ctx) {
    const position = (q.page - 1) * PAGE_SIZE;
    const { data, res, url, body } = await visitorSearch(ctx, q.keyword, { position, count: PAGE_SIZE, remoteOnly: q.remoteOnly, daysAgo: daysAgoFilter(q.hoursOld) });
    const { items, total } = parseJobRightSearch(data);
    const sourceUrl = `${url}#${new URLSearchParams({ value: body.value, workModel: body.workModel.join(','), daysAgo: String(body.daysAgo) })}`;
    const jobs = items.map((i) => jobRightItemToRaw(i, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl, remoteFiltered: q.remoteOnly }));
    const hasMore = items.length >= PAGE_SIZE && (total === undefined || position + items.length < total);
    return { jobs, hasMore, requestUrl: sourceUrl, total };
  },

  async probe(ctx) {
    const { data, res } = await visitorSearch(ctx, 'medical billing', { position: 0, count: 1, remoteOnly: true, retries: 0 });
    const { items, total } = parseJobRightSearch(data);
    return { ok: items.length > 0, message: `visitor search API returned ${items.length} job(s) (total ${total ?? 'n/a'})`, httpStatus: res.status };
  },
};
