import type { RawJob } from '../../models/job.ts';
import { htmlToText } from '../../utils/text.ts';

export interface JoobleJob {
  id?: string | number;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
}

export interface JoobleResponse {
  totalCount?: number;
  jobs?: JoobleJob[];
}

export function parseJooble(data: JoobleResponse, ctx: { fetchedAt: string; keyword: string; sourceUrl: string }): RawJob[] {
  return (data.jobs ?? [])
    .filter((j) => j.title && j.link)
    .map((j) => ({
      source: 'jooble' as const,
      sourceJobId: j.id !== undefined ? String(j.id) : null,
      title: htmlToText(j.title!),
      company: j.company?.trim() || null,
      location: j.location?.trim() || null,
      descriptionHtml: j.snippet ?? null,
      descriptionIsSnippet: true,
      employmentType: j.type ?? null,
      salaryRaw: j.salary?.trim() || null,
      postedAt: j.updated ?? null,
      fetchedAt: ctx.fetchedAt,
      jobUrl: j.link!,
      applyUrl: null,
      sourceUrl: ctx.sourceUrl,
      remoteHints: [],
      countryHint: 'US' as const,
      originSite: j.source?.trim() || null,
      foundBy: [ctx.keyword],
    }));
}
