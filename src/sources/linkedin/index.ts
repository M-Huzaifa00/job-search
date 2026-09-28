import type { RawJob, RemoteHint } from '../../models/job.ts';
import type { SourceAdapter } from '../types.ts';
import { cardToRaw, parseLinkedInDetail, parseLinkedInSearch } from './parse.ts';

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/';
const US_GEO_ID = '103644278';
const PAGE_SIZE = 10;

export const linkedin: SourceAdapter = {
  meta: {
    id: 'linkedin',
    name: 'LinkedIn',
    method: 'http-html',
    methodDetail: 'Public guest job-search endpoints (no login): /jobs-guest/jobs/api/seeMoreJobPostings/search + /jobPosting/{id}',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://www.linkedin.com/jobs',
    notes:
      'Server-side filters: United States, workplace type Remote (f_WT=2), posted within hoursOld (f_TPR). LinkedIn rate-limits guest traffic (HTTP 429); requests are spaced and Retry-After is honoured.',
    hostPolicies: { 'www.linkedin.com': { concurrency: 2, minIntervalMs: 1_200, jitterMs: 800 } },
    concurrency: 2,
    supportsDetails: true,
  },

  async searchJobs(q, ctx) {
    const params = new URLSearchParams({
      keywords: q.keyword,
      location: 'United States',
      geoId: US_GEO_ID,
      f_TPR: `r${Math.round(q.hoursOld * 3600)}`,
      sortBy: 'DD',
      start: String((q.page - 1) * PAGE_SIZE),
    });
    if (q.remoteOnly) params.set('f_WT', '2');
    const url = `${SEARCH_URL}?${params}`;
    const res = await ctx.http.getText(url, { acceptStatuses: [400], signal: ctx.signal, headers: { accept: 'text/html,*/*;q=0.8' } });
    // LinkedIn answers 400 / an empty body once the result set is exhausted.
    if (res.status === 400 || !res.text.trim()) return { jobs: [], hasMore: false, requestUrl: url };
    const cards = parseLinkedInSearch(res.text);
    const jobs = cards.map((c) => cardToRaw(c, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: url, remoteFiltered: q.remoteOnly }));
    return { jobs, hasMore: cards.length >= PAGE_SIZE, requestUrl: url };
  },

  async fetchDetails(job, ctx): Promise<Partial<RawJob> | null> {
    if (!job.sourceJobId) return null;
    const res = await ctx.http.getText(DETAIL_URL + job.sourceJobId, { signal: ctx.signal, retries: 2 });
    const d = parseLinkedInDetail(res.text);
    if (!d.descriptionHtml && !d.title) return null;
    const hints: RemoteHint[] = [];
    if (d.workplace && /hybrid/i.test(d.workplace)) hints.push({ kind: 'structured_hybrid', detail: `LinkedIn: ${d.workplace}` });
    else if (d.workplace && /on-?site/i.test(d.workplace)) hints.push({ kind: 'structured_onsite', detail: `LinkedIn: ${d.workplace}` });
    return {
      title: d.title ?? undefined,
      company: d.company ?? undefined,
      location: d.location ?? undefined,
      descriptionHtml: d.descriptionHtml,
      employmentType: d.employmentType,
      salaryRaw: d.salary ?? job.salaryRaw,
      postedText: d.postedText ?? job.postedText,
      // Detail pages give relative text only; parse it against this response's fetch time.
      fetchedAt: d.postedText ? res.fetchedAt : job.fetchedAt,
      applyUrl: d.applyUrl,
      tags: [d.industries, d.jobFunction].filter((x): x is string => !!x),
      remoteHints: [...job.remoteHints, ...hints],
    };
  },

  async probe(ctx) {
    const res = await ctx.http.getText(`${SEARCH_URL}?keywords=medical%20billing&location=United%20States&f_WT=2&start=0`, { signal: ctx.signal, retries: 0 });
    const n = parseLinkedInSearch(res.text).length;
    return { ok: n > 0, message: `search returned ${n} job cards`, httpStatus: res.status };
  },
};
