import type { RawJob } from '../../models/job.ts';
import { periodFromCode } from '../../core/normalization/salary.ts';
import { sha1 } from '../../utils/text.ts';

export interface CareerjetJob {
  title?: string;
  company?: string;
  locations?: string;
  date?: string;
  url?: string;
  description?: string;
  salary?: string;
  salary_min?: string | number;
  salary_max?: string | number;
  salary_type?: string;
  salary_currency_code?: string;
  site?: string;
}

export interface CareerjetResponse {
  type?: 'JOBS' | 'LOCATIONS' | 'ERROR' | string;
  error?: string;
  hits?: number;
  pages?: number;
  jobs?: CareerjetJob[];
}

const num = (v: string | number | undefined) => (v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function parseCareerjet(data: CareerjetResponse, ctx: { fetchedAt: string; keyword: string; sourceUrl: string }): RawJob[] {
  return (data.jobs ?? [])
    .filter((j) => j.title && j.url)
    .map((j) => {
      const min = num(j.salary_min);
      const max = num(j.salary_max);
      return {
        source: 'careerjet' as const,
        // Tracker URLs differ per query, so identify the listing by its content.
        sourceJobId: sha1(`${j.title}|${j.company ?? ''}|${j.locations ?? ''}|${j.date ?? ''}`),
        title: j.title!.trim(),
        company: j.company?.trim() || null,
        location: j.locations?.trim() || null,
        descriptionHtml: j.description ?? null,
        descriptionIsSnippet: true,
        salaryRaw: j.salary?.trim() || null,
        salary: min !== null || max !== null ? { min, max, currency: j.salary_currency_code ?? null, period: periodFromCode(j.salary_type) } : null,
        postedAt: j.date ?? null,
        fetchedAt: ctx.fetchedAt,
        jobUrl: j.url!,
        applyUrl: null,
        sourceUrl: ctx.sourceUrl,
        remoteHints: [],
        countryHint: 'US' as const,
        originSite: j.site?.trim() || null,
        foundBy: [ctx.keyword],
      };
    });
}
