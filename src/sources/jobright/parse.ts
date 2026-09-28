import type { RawJob, RemoteHint } from '../../models/job.ts';
import { collapseWhitespace } from '../../utils/text.ts';

export interface JobRightJobResult {
  jobId: string;
  jobTitle?: string;
  jobNlpTitle?: string;
  jobSeniority?: string;
  jobLocation?: string;
  isRemote?: boolean;
  workModel?: string;
  /** "2026-09-28 19:19:36" in UTC. */
  publishTime?: string;
  publishTimeDesc?: string;
  salaryDesc?: string;
  employmentType?: string;
  jobSummary?: string;
  coreResponsibilities?: string[];
  requirements?: string[];
  url?: string;
}

export interface JobRightCompanyResult {
  companyName?: string;
  companyURL?: string;
  companyCategories?: string;
}

export interface JobRightItem {
  jobResult?: JobRightJobResult;
  companyResult?: JobRightCompanyResult;
  jobNotes?: { notesMap?: Record<string, string> };
}

export interface JobRightSearchResponse {
  success?: boolean;
  errorMsg?: string | null;
  result?: { jobList?: JobRightItem[]; jobNum?: number } | string;
}

export const JOB_URL = 'https://jobright.ai/jobs/info/';

/** JobRight's publishTime has no zone marker; it is UTC (it matches the site's "N minutes ago"). */
export function parsePublishTime(value: string | undefined): string | null {
  const m = value?.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  return m ? `${m[1]}T${m[2]}Z` : null;
}

/** JobRight exposes AI summaries, not the original posting; stitch them into a readable description. */
function buildDescription(r: JobRightJobResult): string | null {
  const parts: string[] = [];
  if (r.jobSummary?.trim()) parts.push(collapseWhitespace(r.jobSummary));
  const list = (label: string, items?: string[]) => {
    const clean = (items ?? []).map((s) => collapseWhitespace(s)).filter(Boolean);
    if (clean.length) parts.push(`${label}:\n${clean.map((s) => `- ${s}`).join('\n')}`);
  };
  list('Responsibilities', r.coreResponsibilities);
  list('Requirements', r.requirements);
  return parts.length ? parts.join('\n\n') : null;
}

function workModelHints(r: JobRightJobResult, remoteFiltered: boolean): RemoteHint[] {
  const hints: RemoteHint[] = [];
  const model = r.workModel?.trim() ?? '';
  if (/hybrid/i.test(model)) hints.push({ kind: 'structured_hybrid', detail: `JobRight: ${model}` });
  else if (/on-?site/i.test(model)) hints.push({ kind: 'structured_onsite', detail: `JobRight: ${model}` });
  else if (/remote/i.test(model) || r.isRemote) hints.push({ kind: 'structured_remote', detail: `JobRight: ${model || 'isRemote'}` });
  if (remoteFiltered) hints.push({ kind: 'source_remote_filter', detail: 'JobRight work model = Remote' });
  return hints;
}

export function parseJobRightSearch(data: JobRightSearchResponse): { items: JobRightItem[]; total: number | undefined } {
  const result = typeof data.result === 'object' && data.result ? data.result : {};
  const items = (result.jobList ?? []).filter((i) => i?.jobResult?.jobId && (i.jobResult.jobTitle || i.jobResult.jobNlpTitle));
  return { items, total: result.jobNum };
}

export function jobRightItemToRaw(item: JobRightItem, ctx: { fetchedAt: string; keyword: string; sourceUrl: string; remoteFiltered: boolean }): RawJob {
  const r = item.jobResult!;
  const c = item.companyResult ?? {};
  const categories = (c.companyCategories ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    source: 'jobright',
    sourceJobId: r.jobId,
    title: collapseWhitespace(r.jobTitle || r.jobNlpTitle || ''),
    company: c.companyName?.trim() || null,
    companyUrl: c.companyURL?.trim() || null,
    location: r.jobLocation?.trim() || null,
    descriptionText: buildDescription(r),
    descriptionIsSnippet: true,
    employmentType: r.employmentType ?? null,
    salaryRaw: r.salaryDesc?.trim() || null,
    postedAt: parsePublishTime(r.publishTime),
    postedText: r.publishTimeDesc ?? null,
    fetchedAt: ctx.fetchedAt,
    jobUrl: `${JOB_URL}${r.jobId}`,
    applyUrl: null,
    sourceUrl: ctx.sourceUrl,
    tags: [...categories, ...(r.jobSeniority ? [r.jobSeniority] : [])],
    remoteHints: workModelHints(r, ctx.remoteFiltered),
    countryHint: 'US',
    foundBy: [ctx.keyword],
  };
}
