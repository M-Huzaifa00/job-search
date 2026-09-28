import type { RawJob, SalaryPeriod } from '../../models/job.ts';
import { periodFromCode } from '../../core/normalization/salary.ts';

export interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName?: string;
  jobIndustry?: string[] | string;
  jobType?: string[] | string;
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
}

export interface JobicyResponse {
  jobCount?: number;
  jobs?: JobicyJob[];
}

const list = (v: string[] | string | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export function parseJobicy(data: JobicyResponse, ctx: { fetchedAt: string; keyword: string; sourceUrl: string; geoFiltered: boolean }): RawJob[] {
  return (data.jobs ?? [])
    .filter((j) => j && j.id && j.jobTitle && j.url)
    .map((j) => {
      const geo = j.jobGeo?.trim() || null;
      const hasSalary = typeof j.salaryMin === 'number' || typeof j.salaryMax === 'number';
      const period: SalaryPeriod | null = periodFromCode(j.salaryPeriod);
      return {
        source: 'jobicy' as const,
        sourceJobId: String(j.id),
        title: j.jobTitle.trim(),
        company: j.companyName?.trim() || null,
        location: geo,
        descriptionHtml: j.jobDescription ?? null,
        descriptionText: j.jobDescription ? null : (j.jobExcerpt ?? null),
        employmentType: list(j.jobType).join(', ') || null,
        salary: hasSalary ? { min: j.salaryMin ?? null, max: j.salaryMax ?? null, currency: j.salaryCurrency ?? null, period } : null,
        postedAt: j.pubDate ?? null,
        fetchedAt: ctx.fetchedAt,
        jobUrl: j.url,
        applyUrl: null,
        sourceUrl: ctx.sourceUrl,
        tags: [...list(j.jobIndustry), ...(j.jobLevel ? [j.jobLevel] : [])],
        remoteHints: [{ kind: 'remote_only_board' as const, detail: 'Jobicy lists remote jobs only' }],
        applicantLocations: geo ? [geo] : [],
        countryHint: ctx.geoFiltered ? ('US' as const) : null,
        foundBy: [ctx.keyword],
      };
    });
}
