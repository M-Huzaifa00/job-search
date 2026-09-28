import type { NormalizedJob, SourceId } from './job.ts';

export interface SearchRequest {
  titles: string[];
  country: 'US';
  remoteOnly: boolean;
  hoursOld: number;
  /** Explicit source selection; when omitted the default-enabled sources run. */
  sources?: SourceId[];
  maxPagesPerKeyword?: number;
  maxResultsPerSource?: number;
  maxResultsPerKeyword?: number;
  includeDuplicates?: boolean;
  /** Debug aid: also return rejected jobs with the reason they were rejected. */
  includeRejected?: boolean;
  /** Include jobs whose posting date cannot be determined (they are sorted last). */
  includeUndated?: boolean;
  fetchDetails?: boolean;
  persist?: boolean;
}

export type SourceRunStatus = 'OK' | 'PARTIAL' | 'ERROR' | 'BLOCKED' | 'SKIPPED';

export interface SourceRunReport {
  source: SourceId;
  name: string;
  status: SourceRunStatus;
  method: string;
  raw: number;
  unique: number;
  accepted: number;
  requests: number;
  detailsFetched: number;
  errors: { category: string; message: string; keyword?: string }[];
  rejected: Record<string, number>;
  durationMs: number;
  note?: string;
}

export interface RunMetrics {
  search_keywords: number;
  sources_requested: number;
  raw_listings: number;
  unique_listings: number;
  removed_indeed: number;
  removed_invalid: number;
  removed_low_quality: number;
  removed_irrelevant: number;
  removed_non_us: number;
  removed_not_remote: number;
  removed_too_old: number;
  removed_duplicates: number;
  final_unique_jobs: number;
  /** Final jobs whose listing or application goes through Indeed. */
  indeed_jobs: number;
}

export interface SearchSummary {
  sources_attempted: number;
  sources_succeeded: number;
  sources_failed: number;
  sources_skipped: number;
  raw_jobs_found: number;
  remote_us_jobs: number;
  deduplicated_jobs: number;
  new_jobs: number;
  duration_ms: number;
  timed_out: boolean;
}

export interface SearchResult {
  run_id: string;
  query: SearchRequest;
  summary: SearchSummary;
  metrics: RunMetrics;
  sources: SourceRunReport[];
  jobs: NormalizedJob[];
  rejected?: NormalizedJob[];
}
