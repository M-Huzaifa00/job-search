export const SOURCE_IDS = [
  'linkedin',
  'ziprecruiter',
  'glassdoor',
  'simplyhired',
  'careerbuilder',
  'monster',
  'dice',
  'wellfound',
  'remoteok',
  'remotive',
  'jobicy',
  'jooble',
  'canada_job_bank',
  'careerjet',
  'builtin',
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export type RemoteType = 'fully_remote' | 'hybrid' | 'onsite' | 'unclear';
export type DateConfidence = 'exact' | 'estimated' | 'unknown';
export type ListingType = 'direct_employer' | 'staffing_agency' | 'job_board' | 'unknown';
export type SalaryPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';

/** A structured signal an adapter knows about the workplace type (from filters, schema.org, tags). */
export interface RemoteHint {
  kind:
    | 'source_remote_filter' // the search itself was restricted to remote jobs by the platform
    | 'remote_only_board' // the platform only lists remote jobs
    | 'structured_remote' // schema.org TELECOMMUTE, workplace tag "Remote", etc.
    | 'structured_hybrid'
    | 'structured_onsite';
  detail: string;
}

export interface SalaryInfo {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

/** What a source adapter returns. Everything is optional except identity + title + URL. */
export interface RawJob {
  source: SourceId;
  sourceJobId: string | null;
  title: string;
  company: string | null;
  companyUrl?: string | null;
  location: string | null;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  /** True when the description is only a search-result snippet. */
  descriptionIsSnippet?: boolean;
  employmentType?: string | null;
  salaryRaw?: string | null;
  salary?: SalaryInfo | null;
  /** Absolute timestamp (ISO string or epoch ms) when the source exposes one. */
  postedAt?: string | number | null;
  /** Relative text such as "3 hours ago" / "Today". */
  postedText?: string | null;
  /** When the response containing this job was fetched (relative dates are parsed against this). */
  fetchedAt: string;
  jobUrl: string;
  applyUrl?: string | null;
  /** The search/feed URL that surfaced the listing (secrets removed). */
  sourceUrl?: string | null;
  tags?: string[];
  requirements?: string[];
  benefits?: string[];
  remoteHints: RemoteHint[];
  /** Country the platform search was restricted to, when known. */
  countryHint?: 'US' | 'CA' | null;
  /** Explicit applicant location requirements (schema.org applicantLocationRequirements, Remotive candidate_required_location). */
  applicantLocations?: string[];
  /** The platform itself says the application goes through Indeed. */
  viaIndeed?: boolean;
  /** The platform name of the original source (aggregators like Jooble/CareerJet expose this). */
  originSite?: string | null;
  detailFetched?: boolean;
  /** Search keywords that surfaced this listing. */
  foundBy: string[];
}

export interface RejectionReason {
  code:
    | 'indeed'
    | 'invalid'
    | 'low_quality'
    | 'irrelevant'
    | 'non_us'
    | 'not_remote'
    | 'too_old'
    | 'duplicate';
  detail: string;
}

export interface NormalizedJob {
  id: string;
  source: string;
  source_id: SourceId;
  source_job_id: string | null;
  sources: string[];

  title: string;
  company: string | null;
  company_domain: string | null;

  location: string | null;
  remote_type: RemoteType;
  remote_scope: string | null;
  remote_confidence: number;
  remote_evidence: string[];
  us_eligible: boolean;

  employment_type: string | null;

  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;

  description: string | null;
  description_text: string | null;
  description_is_snippet: boolean;
  requirements: string[];
  benefits: string[];

  matched_keyword: string | null;
  matched_keywords: string[];
  keyword_category: string | null;
  keyword_confidence: number;
  medical_role_score: number;

  posted_at: string | null;
  scraped_at: string;
  age_hours: number | null;
  date_confidence: DateConfidence;

  job_url: string;
  apply_url: string | null;
  canonical_url: string;
  source_url: string | null;

  ats_provider: string | null;
  ats_job_id: string | null;
  listing_type: ListingType;
  quality_flags: string[];

  is_duplicate: boolean;
  duplicate_of: string | null;
  duplicate_count: number;

  first_seen_at: string | null;
  last_seen_at: string | null;
  reposted_at: string | null;
  is_new: boolean | null;

  found_by: string[];
  detail_fetched: boolean;
  rejection: RejectionReason | null;
}
