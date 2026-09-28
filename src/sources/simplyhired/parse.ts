import type { RawJob, RemoteHint } from '../../models/job.ts';
import { periodFromCode } from '../../core/normalization/salary.ts';
import { SourceError } from '../../http/errors.ts';

export interface SimplyHiredJob {
  jobKey: string;
  title: string;
  company?: string;
  location?: string;
  snippet?: string;
  salaryInfo?: string;
  indeedApply?: boolean;
  dateOnIndeed?: number;
  remoteAttributes?: string[];
  jobTypes?: string[];
  requirements?: string[];
  benefits?: string[];
}

export interface SimplyHiredSearchData {
  jobs: SimplyHiredJob[];
  resultCount: number;
  pageCursors: Record<string, string>;
}

export interface SimplyHiredDetail {
  jobKey?: string;
  jobTitle?: string;
  employerName?: string;
  formattedLocation?: string;
  jobDescriptionHtml?: string;
  isIndeedApply?: boolean;
  datePublished?: number;
  dateOnIndeed?: number;
  expired?: boolean;
  workSettings?: string[];
  jobTypes?: string[];
  benefits?: string[];
  compensation?: string;
  baseSalary?: { minMinor?: number; maxMinor?: number; unitOfWork?: string; currencyCode?: string };
}

function nextData(html: string): Record<string, unknown> {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new SourceError('PARSING_ERROR', 'SimplyHired page has no __NEXT_DATA__');
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch (err) {
    throw new SourceError('PARSING_ERROR', 'SimplyHired __NEXT_DATA__ is not valid JSON', { cause: err });
  }
}

export function parseSimplyHiredSearch(html: string): SimplyHiredSearchData {
  const props = (nextData(html).props as Record<string, unknown>)?.pageProps as Record<string, unknown>;
  return {
    jobs: Array.isArray(props?.jobs) ? (props.jobs as SimplyHiredJob[]) : [],
    resultCount: Number(props?.resultCount ?? 0),
    pageCursors: (props?.pageCursors as Record<string, string>) ?? {},
  };
}

export function parseSimplyHiredDetail(html: string): SimplyHiredDetail | null {
  const props = (nextData(html).props as Record<string, unknown>)?.pageProps as Record<string, unknown>;
  return (props?.viewJobData as SimplyHiredDetail) ?? (props?.jobKey ? (props as SimplyHiredDetail) : null);
}

function remoteHints(attrs: string[] | undefined, filtered: boolean): RemoteHint[] {
  const hints: RemoteHint[] = [];
  if (filtered) hints.push({ kind: 'source_remote_filter', detail: 'SimplyHired work location = remote' });
  for (const a of attrs ?? []) {
    if (/hybrid/i.test(a)) hints.push({ kind: 'structured_hybrid', detail: `SimplyHired: ${a}` });
    else if (/remote/i.test(a)) hints.push({ kind: 'structured_remote', detail: `SimplyHired: ${a}` });
  }
  return hints;
}

export function simplyHiredJobToRaw(j: SimplyHiredJob, ctx: { fetchedAt: string; keyword: string; sourceUrl: string; remoteFiltered: boolean }): RawJob {
  return {
    source: 'simplyhired',
    sourceJobId: j.jobKey,
    title: j.title,
    company: j.company?.trim() || null,
    location: j.location?.trim() || null,
    descriptionText: j.snippet ?? null,
    descriptionIsSnippet: true,
    employmentType: j.jobTypes?.find((t) => /time|contract|temporary|per diem/i.test(t)) ?? null,
    salaryRaw: j.salaryInfo?.trim() || null,
    postedAt: j.dateOnIndeed ?? null,
    fetchedAt: ctx.fetchedAt,
    jobUrl: `https://www.simplyhired.com/job/${j.jobKey}`,
    applyUrl: null,
    sourceUrl: ctx.sourceUrl,
    requirements: j.requirements ?? [],
    benefits: j.benefits ?? [],
    remoteHints: remoteHints(j.remoteAttributes, ctx.remoteFiltered),
    countryHint: 'US',
    viaIndeed: j.indeedApply === true,
    foundBy: [ctx.keyword],
  };
}

export function simplyHiredDetailToRaw(d: SimplyHiredDetail, job: RawJob): Partial<RawJob> {
  const s = d.baseSalary;
  return {
    title: d.jobTitle ?? job.title,
    company: d.employerName ?? job.company,
    location: d.formattedLocation ?? job.location,
    descriptionHtml: d.jobDescriptionHtml ?? null,
    descriptionText: null,
    descriptionIsSnippet: !d.jobDescriptionHtml,
    postedAt: d.datePublished ?? d.dateOnIndeed ?? job.postedAt,
    salaryRaw: d.compensation ?? job.salaryRaw,
    salary:
      s && (s.minMinor || s.maxMinor)
        ? { min: s.minMinor ? s.minMinor / 100 : null, max: s.maxMinor ? s.maxMinor / 100 : null, currency: s.currencyCode ?? null, period: periodFromCode(s.unitOfWork) }
        : job.salary,
    benefits: d.benefits ?? job.benefits,
    remoteHints: [...job.remoteHints, ...remoteHints(d.workSettings, false)],
    viaIndeed: job.viaIndeed || d.isIndeedApply === true,
  };
}
