import type { RawJob } from '../../models/job.ts';
import { extractJobPostingJsonLd, jobPostingToRaw } from '../shared/jsonld.ts';
import type { SourceAdapter } from '../types.ts';
import { diceCardToRaw, parseDiceSearch } from './parse.ts';

const PAGE_SIZE = 20;

function postedDateFilter(hoursOld: number): string | null {
  if (hoursOld <= 24) return 'ONE';
  if (hoursOld <= 72) return 'THREE';
  if (hoursOld <= 168) return 'SEVEN';
  return null;
}

export const dice: SourceAdapter = {
  meta: {
    id: 'dice',
    name: 'Dice',
    method: 'http-html',
    methodDetail: 'Server-rendered search page (https://www.dice.com/jobs) + schema.org JobPosting JSON-LD on job-detail pages',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://www.dice.com',
    notes: 'Tech-focused board: expect mostly EHR/revenue-cycle-systems roles. Server-side filters: workplace type Remote, posted date (1/3/7 days).',
    hostPolicies: { 'www.dice.com': { concurrency: 2, minIntervalMs: 800, jitterMs: 500 } },
    concurrency: 2,
    supportsDetails: true,
  },

  async searchJobs(q, ctx) {
    const params = new URLSearchParams({ q: q.keyword, page: String(q.page), pageSize: String(PAGE_SIZE) });
    if (q.remoteOnly) params.set('filters.workplaceTypes', 'Remote');
    const posted = postedDateFilter(q.hoursOld);
    if (posted) params.set('filters.postedDate', posted);
    const url = `https://www.dice.com/jobs?${params}`;
    const res = await ctx.http.getText(url, { signal: ctx.signal });
    const cards = parseDiceSearch(res.text);
    const jobs = cards.map((c) => diceCardToRaw(c, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: url, remoteFiltered: q.remoteOnly }));
    return { jobs, hasMore: cards.length >= PAGE_SIZE, requestUrl: url };
  },

  async fetchDetails(job, ctx): Promise<Partial<RawJob> | null> {
    const res = await ctx.http.getText(job.jobUrl, { signal: ctx.signal, retries: 2 });
    const ld = extractJobPostingJsonLd(res.text);
    if (!ld) return null;
    const d = jobPostingToRaw(ld);
    return {
      ...d,
      // The JSON-LD url is the Dice page itself; applications happen on Dice.
      applyUrl: null,
      remoteHints: [...job.remoteHints, ...(d.remoteHints ?? [])],
      fetchedAt: res.fetchedAt,
    };
  },

  async probe(ctx) {
    const res = await ctx.http.getText('https://www.dice.com/jobs?q=medical%20billing&filters.workplaceTypes=Remote', { signal: ctx.signal, retries: 0 });
    const n = parseDiceSearch(res.text).length;
    return { ok: n > 0, message: `search returned ${n} job cards`, httpStatus: res.status };
  },
};
