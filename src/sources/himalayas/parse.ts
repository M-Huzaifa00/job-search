import type { RawJob, SalaryInfo, SalaryPeriod } from '../../models/job.ts';
import { collapseWhitespace } from '../../utils/text.ts';

export interface HimalayasJob {
  title?: string;
  excerpt?: string;
  companyName?: string;
  companySlug?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  seniority?: string[];
  locationRestrictions?: string[];
  categories?: string[];
  parentCategories?: string[];
  description?: string;
  /** Unix seconds. */
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

export interface HimalayasResponse {
  totalCount?: number;
  limit?: number;
  jobs?: HimalayasJob[];
}

const PERIODS: Record<string, SalaryPeriod> = { hourly: 'hour', weekly: 'week', monthly: 'month', annual: 'year', yearly: 'year' };

function salaryOf(j: HimalayasJob): SalaryInfo | null {
  if (j.minSalary == null && j.maxSalary == null) return null;
  return { min: j.minSalary ?? null, max: j.maxSalary ?? null, currency: j.currency || null, period: PERIODS[j.salaryPeriod ?? 'annual'] ?? null };
}

/** Category slugs look like "Medical-Billing-Specialist"; make them readable for keyword matching. */
function readable(slug: string): string {
  return slug.replace(/-/g, ' ');
}

export function parseHimalayas(data: HimalayasResponse, ctx: { fetchedAt: string; keyword: string; sourceUrl: string; usFiltered: boolean }): RawJob[] {
  return (data.jobs ?? [])
    .filter((j) => j && j.guid && j.title)
    .map((j) => {
      const restrictions = (j.locationRestrictions ?? []).map((s) => s.trim()).filter(Boolean);
      const apply = j.applicationLink && j.applicationLink !== j.guid ? j.applicationLink : null;
      return {
        source: 'himalayas' as const,
        sourceJobId: j.guid!,
        title: collapseWhitespace(j.title!),
        company: j.companyName?.trim() || null,
        location: restrictions.length ? restrictions.join(', ') : null,
        descriptionHtml: j.description ?? null,
        descriptionText: j.description ? null : (j.excerpt ?? null),
        descriptionIsSnippet: !j.description,
        employmentType: j.employmentType ?? null,
        salary: salaryOf(j),
        postedAt: j.pubDate ?? null,
        fetchedAt: ctx.fetchedAt,
        jobUrl: j.guid!,
        applyUrl: apply,
        sourceUrl: ctx.sourceUrl,
        tags: [...(j.parentCategories ?? []), ...(j.categories ?? []).map(readable), ...(j.seniority ?? [])],
        remoteHints: [{ kind: 'remote_only_board' as const, detail: 'Himalayas lists remote jobs only' }],
        // No restriction means the job is open worldwide, which includes the US.
        applicantLocations: restrictions.length ? restrictions : ['Worldwide'],
        countryHint: ctx.usFiltered ? ('US' as const) : null,
        foundBy: [ctx.keyword],
      };
    });
}
