import type { NormalizedJob } from '../../models/job.ts';
import { isPlaceholderCompany } from '../normalization/company.ts';
import { isHttpUrl, isIndeedUrl } from '../normalization/url.ts';

export interface FinalFilterParams {
  hoursOld: number;
  remoteOnly: boolean;
  includeUndated: boolean;
  /** Reject Indeed URLs (default true). */
  excludeIndeed?: boolean;
}

/**
 * Last line of defence before a job is written to CSV/JSON. It re-checks every hard requirement
 * independently of the classifiers so an adapter or classifier bug cannot leak a bad row.
 */
export function isValidFinalJob(job: NormalizedJob, params: FinalFilterParams): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (job.rejection) reasons.push(`rejected: ${job.rejection.code}`);
  if (job.matched_keywords.length === 0 || job.keyword_confidence < 0.55) reasons.push('not relevant to requested titles');
  if (params.remoteOnly && job.remote_type !== 'fully_remote') reasons.push(`remote_type is ${job.remote_type}`);
  if (!job.us_eligible) reasons.push('not available to US workers');
  if (job.age_hours !== null && job.age_hours > params.hoursOld) reasons.push(`older than ${params.hoursOld}h`);
  if (job.age_hours === null && !params.includeUndated) reasons.push('unknown posting date');
  if (params.excludeIndeed ?? true) {
    for (const url of [job.job_url, job.apply_url, job.canonical_url, job.source_url]) {
      if (url && isIndeedUrl(url)) reasons.push('Indeed URL');
    }
  }
  if (!isHttpUrl(job.job_url)) reasons.push('invalid job URL');
  if (job.apply_url && !isHttpUrl(job.apply_url)) reasons.push('invalid apply URL');
  if (!job.title || job.title.trim().length < 3) reasons.push('missing title');
  if (isPlaceholderCompany(job.company)) reasons.push('missing employer');
  return { ok: reasons.length === 0, reasons };
}
