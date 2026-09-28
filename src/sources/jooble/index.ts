import type { RawJob } from '../../models/job.ts';
import { isJobBoardUrl, stripTracking } from '../../core/normalization/url.ts';
import { extractJobPostingJsonLd, jobPostingToRaw } from '../shared/jsonld.ts';
import { resolveRedirects } from '../shared/redirects.ts';
import type { SourceAdapter } from '../types.ts';
import { parseJooble, type JoobleResponse } from './parse.ts';

function apiUrl(key: string): string {
  const host = process.env.JOOBLE_API_HOST?.trim() || 'jooble.org';
  return `https://${host}/api/${encodeURIComponent(key)}`;
}

export const jooble: SourceAdapter = {
  meta: {
    id: 'jooble',
    name: 'Jooble',
    method: 'api',
    methodDetail: 'Official REST API (POST https://jooble.org/api/{key}) — requires a free partner API key',
    status: 'requires_key',
    defaultEnabled: true,
    homepage: 'https://jooble.org',
    notes:
      'The public website is behind a Cloudflare challenge (HTTP 403), so only the official API is used. Implemented against the documented API contract; it could not be verified end-to-end without a key.',
    requirement: 'Request a free API key at https://jooble.org/api/about and set JOOBLE_API_KEY.',
    hostPolicies: { 'jooble.org': { concurrency: 2, minIntervalMs: 800, jitterMs: 400 } },
    concurrency: 2,
    supportsDetails: true,
  },

  unavailableReason(config) {
    return config.keys.jooble ? null : { category: 'AUTH_REQUIRED', message: 'JOOBLE_API_KEY is not set' };
  },

  async searchJobs(q, ctx) {
    const key = ctx.config.keys.jooble!;
    const since = new Date(Date.now() - q.hoursOld * 3_600_000).toISOString().slice(0, 10);
    const body = JSON.stringify({
      keywords: q.remoteOnly ? `${q.keyword} remote` : q.keyword,
      location: 'United States',
      page: String(q.page),
      ResultOnPage: String(Math.min(q.maxResults, 50)),
      datecreatedfrom: since,
    });
    const url = apiUrl(key);
    const res = await ctx.http.request(url, { method: 'POST', body, headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: ctx.signal, cacheTtlMs: ctx.config.searchCacheTtlMs });
    const data = JSON.parse(res.text) as JoobleResponse;
    const jobs = parseJooble(data, { fetchedAt: res.fetchedAt, keyword: q.keyword, sourceUrl: 'https://jooble.org/api/***' });
    const total = data.totalCount ?? 0;
    return { jobs, hasMore: jobs.length > 0 && q.page * Math.min(q.maxResults, 50) < total, requestUrl: 'https://jooble.org/api/***', total };
  },

  async fetchDetails(job, ctx): Promise<Partial<RawJob> | null> {
    const resolved = await resolveRedirects(ctx.http, job.jobUrl, { readFinalBody: true, signal: ctx.signal });
    if (resolved.viaIndeed) return { viaIndeed: true, applyUrl: resolved.finalUrl };
    const out: Partial<RawJob> = {};
    if (!isJobBoardUrl(resolved.finalUrl)) out.applyUrl = stripTracking(resolved.finalUrl);
    const ld = resolved.html ? extractJobPostingJsonLd(resolved.html) : null;
    if (ld) {
      const d = jobPostingToRaw(ld);
      if (d.descriptionHtml) {
        out.descriptionHtml = d.descriptionHtml;
        out.descriptionIsSnippet = false;
      }
      if (d.postedAt) out.postedAt = d.postedAt;
      if (d.applicantLocations) out.applicantLocations = d.applicantLocations;
      if (d.remoteHints?.length) out.remoteHints = [...job.remoteHints, ...d.remoteHints];
    }
    return out;
  },
};
