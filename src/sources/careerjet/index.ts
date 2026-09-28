import type { RawJob } from '../../models/job.ts';
import { SourceError } from '../../http/errors.ts';
import { isJobBoardUrl, stripTracking } from '../../core/normalization/url.ts';
import { extractJobPostingJsonLd, jobPostingToRaw } from '../shared/jsonld.ts';
import { resolveRedirects } from '../shared/redirects.ts';
import type { SourceAdapter } from '../types.ts';
import { parseCareerjet, type CareerjetResponse } from './parse.ts';

const API_URL = 'http://public.api.careerjet.net/search';
const PAGE_SIZE = 50;

export const careerjet: SourceAdapter = {
  meta: {
    id: 'careerjet',
    name: 'CareerJet',
    method: 'api',
    methodDetail: 'Public job-search API v3 (public.api.careerjet.net/search, locale en_US, sorted by date); detail step follows the click-tracker to the destination page',
    status: 'working',
    defaultEnabled: true,
    homepage: 'https://www.careerjet.com',
    notes:
      'The API requires a Referer header (set CAREERJET_REFERER) and an affiliate id is recommended (CAREERJET_AFFID). Results are snippets; each accepted candidate is resolved through jobviewtrack.com so Indeed destinations are rejected and employer JSON-LD can be read.',
    hostPolicies: {
      'public.api.careerjet.net': { concurrency: 2, minIntervalMs: 700, jitterMs: 400 },
      'jobviewtrack.com': { concurrency: 2, minIntervalMs: 800, jitterMs: 400 },
    },
    concurrency: 2,
    supportsDetails: true,
  },

  async searchJobs(q, ctx) {
    const params = new URLSearchParams({
      locale_code: 'en_US',
      keywords: q.remoteOnly ? `${q.keyword} remote` : q.keyword,
      location: 'USA',
      sort: 'date',
      pagesize: String(PAGE_SIZE),
      page: String(q.page),
      user_ip: '127.0.0.1',
      user_agent: ctx.config.userAgent,
    });
    if (ctx.config.keys.careerjetAffid) params.set('affid', ctx.config.keys.careerjetAffid);
    const url = `${API_URL}?${params}`;
    const { data, res } = await ctx.http.getJson<CareerjetResponse>(url, {
      signal: ctx.signal,
      headers: { referer: ctx.config.careerjetReferer },
      cacheTtlMs: ctx.config.searchCacheTtlMs,
    });
    if (data.type === 'ERROR') throw new SourceError('HTTP_ERROR', `CareerJet API error: ${data.error ?? 'unknown'}`);
    if (data.type === 'LOCATIONS') return { jobs: [], hasMore: false, requestUrl: url };
    const sourceUrl = url.replace(/([?&]user_agent=)[^&]*/, '$1…');
    const jobs = parseCareerjet(data, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl });
    return { jobs, hasMore: (data.pages ?? 0) > q.page && jobs.length > 0, requestUrl: sourceUrl, total: data.hits };
  },

  async fetchDetails(job, ctx): Promise<Partial<RawJob> | null> {
    const resolved = await resolveRedirects(ctx.http, job.jobUrl, { readFinalBody: true, signal: ctx.signal });
    if (resolved.viaIndeed) return { viaIndeed: true, applyUrl: resolved.finalUrl };
    const out: Partial<RawJob> = {};
    if (resolved.status === 404 || resolved.status === 410) return { applyUrl: null, descriptionIsSnippet: true };
    if (!isJobBoardUrl(resolved.finalUrl)) out.applyUrl = stripTracking(resolved.finalUrl);
    const ld = resolved.html ? extractJobPostingJsonLd(resolved.html) : null;
    if (ld) {
      const d = jobPostingToRaw(ld);
      if (d.descriptionHtml) {
        out.descriptionHtml = d.descriptionHtml;
        out.descriptionIsSnippet = false;
      }
      if (d.postedAt) out.postedAt = d.postedAt;
      if (d.employmentType) out.employmentType = d.employmentType;
      if (d.salary && !job.salary) out.salary = d.salary;
      if (d.applicantLocations) out.applicantLocations = d.applicantLocations;
      if (d.remoteHints?.length) out.remoteHints = [...job.remoteHints, ...d.remoteHints];
      if (d.location && !job.location) out.location = d.location;
    }
    return out;
  },

  async probe(ctx) {
    const url = `${API_URL}?locale_code=en_US&keywords=medical%20billing&location=USA&pagesize=1&user_ip=127.0.0.1&user_agent=probe`;
    const { data, res } = await ctx.http.getJson<CareerjetResponse>(url, { signal: ctx.signal, retries: 0, headers: { referer: ctx.config.careerjetReferer } });
    return { ok: data.type === 'JOBS', message: data.type === 'JOBS' ? `API reachable (${data.hits} hits)` : `API answered ${data.type}: ${data.error ?? ''}`, httpStatus: res.status };
  },
};
