import type { NormalizedJob } from '../../models/job.ts';

function employerRank(j: NormalizedJob): number {
  if (j.ats_provider) return 2;
  return j.listing_type === 'direct_employer' ? 1 : 0;
}

/**
 * Default ordering:
 *  1. most recently posted (compared in whole hours so the tie-breakers below matter)
 *  2. higher remote confidence
 *  3. higher keyword relevance
 *  4. employer ATS / direct employer listings when otherwise equivalent
 * Undated jobs go last.
 */
export function rankJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  return [...jobs].sort((a, b) => {
    const aa = a.age_hours;
    const bb = b.age_hours;
    if (aa === null && bb !== null) return 1;
    if (bb === null && aa !== null) return -1;
    if (aa !== null && bb !== null) {
      const d = Math.floor(aa) - Math.floor(bb);
      if (d !== 0) return d;
    }
    return (
      b.remote_confidence - a.remote_confidence ||
      b.keyword_confidence - a.keyword_confidence ||
      employerRank(b) - employerRank(a) ||
      (aa ?? 0) - (bb ?? 0) ||
      a.title.localeCompare(b.title)
    );
  });
}
