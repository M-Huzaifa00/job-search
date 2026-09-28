import type { RawJob } from '../../models/job.ts';

export interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export interface RemotiveResponse {
  'job-count'?: number;
  jobs?: RemotiveJob[];
}

export function parseRemotive(data: RemotiveResponse, ctx: { fetchedAt: string; keyword: string; sourceUrl: string }): RawJob[] {
  return (data.jobs ?? [])
    .filter((j) => j && j.id && j.title && j.url)
    .map((j) => {
      const loc = j.candidate_required_location?.trim() || null;
      return {
        source: 'remotive' as const,
        sourceJobId: String(j.id),
        title: j.title.trim(),
        company: j.company_name?.trim() || null,
        location: loc,
        descriptionHtml: j.description ?? null,
        employmentType: j.job_type ?? null,
        salaryRaw: j.salary?.trim() || null,
        postedAt: j.publication_date ?? null,
        fetchedAt: ctx.fetchedAt,
        jobUrl: j.url,
        applyUrl: null,
        sourceUrl: ctx.sourceUrl,
        tags: [...(j.tags ?? []), ...(j.category ? [j.category] : [])],
        remoteHints: [{ kind: 'remote_only_board' as const, detail: 'Remotive lists remote jobs only' }],
        applicantLocations: loc ? [loc] : [],
        countryHint: null,
        foundBy: [ctx.keyword],
      };
    });
}
