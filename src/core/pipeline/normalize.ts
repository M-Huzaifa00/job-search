import type { NormalizedJob, RawJob, RejectionReason, SourceId } from '../../models/job.ts';
import { htmlToText, sha1 } from '../../utils/text.ts';
import { isJobBoardCompany, classifyListingType } from '../classifier/listingType.ts';
import { classifyLocation } from '../classifier/location.ts';
import { assessQuality } from '../classifier/quality.ts';
import { classifyRelevance } from '../classifier/relevance.ts';
import { classifyRemote } from '../classifier/remote.ts';
import { ageHours, resolvePostedDate } from '../normalization/date.ts';
import { formatSalary, parseSalary } from '../normalization/salary.ts';
import {
  canonicalizeUrl,
  detectAts,
  isIndeedUrl,
  isJobBoardUrl,
  isRedirectTracker,
  mentionsIndeedOrigin,
  registrableDomain,
  stripTracking,
} from '../normalization/url.ts';

export interface NormalizeOptions {
  terms: string[];
  hoursOld: number;
  remoteOnly: boolean;
  includeUndated: boolean;
  excludeRepostAggregators: boolean;
  /** Reject listings routed through Indeed (default true). */
  excludeIndeed?: boolean;
  now: Date;
  sourceName: (id: SourceId) => string;
}

function isEmployerUrl(url: string | null | undefined): boolean {
  return !!url && !isJobBoardUrl(url) && !isRedirectTracker(url);
}

/** Converts an adapter's raw listing into the normalized schema and runs every classifier. */
export function normalizeJob(raw: RawJob, opts: NormalizeOptions): NormalizedJob {
  const descriptionText = (raw.descriptionText?.trim() || htmlToText(raw.descriptionHtml)).trim() || null;
  const description = raw.descriptionHtml?.trim() || descriptionText;

  const salary = raw.salary ?? parseSalary(raw.salaryRaw);
  const salaryRaw = raw.salaryRaw?.trim() || formatSalary(raw.salary);

  const date = resolvePostedDate({ postedAt: raw.postedAt, postedText: raw.postedText }, raw.fetchedAt);
  const age = ageHours(date.postedAt, opts.now);

  const jobUrl = stripTracking(raw.jobUrl);
  const applyUrl = raw.applyUrl ? stripTracking(raw.applyUrl) : null;
  const canonicalSource = isEmployerUrl(applyUrl) ? applyUrl! : jobUrl;
  const canonicalUrl = canonicalizeUrl(canonicalSource);
  const ats = detectAts(applyUrl) ?? detectAts(jobUrl);

  let companyDomain: string | null = null;
  if (isEmployerUrl(applyUrl) && !ats) companyDomain = registrableDomain(applyUrl);
  else if (raw.companyUrl && isEmployerUrl(raw.companyUrl)) companyDomain = registrableDomain(raw.companyUrl);

  const relevance = classifyRelevance({ title: raw.title, description: descriptionText, company: raw.company, tags: raw.tags }, opts.terms);
  const remote = classifyRemote({ title: raw.title, location: raw.location, description: descriptionText, hints: raw.remoteHints });
  const location = classifyLocation({
    title: raw.title,
    location: raw.location,
    description: descriptionText,
    applicantLocations: raw.applicantLocations,
    countryHint: raw.countryHint,
  });
  const quality = assessQuality({
    title: raw.title,
    company: raw.company,
    description: descriptionText,
    descriptionIsSnippet: !!raw.descriptionIsSnippet,
    jobUrl,
    applyUrl,
    atsProvider: ats?.provider ?? null,
  });
  const listingType = classifyListingType({
    company: raw.company,
    description: descriptionText,
    atsProvider: ats?.provider ?? null,
    applyDomainMatchesCompany: quality.applyDomainMatchesCompany,
  });

  const viaIndeed = [jobUrl, applyUrl, canonicalUrl, raw.sourceUrl].some((u) => isIndeedUrl(u)) || !!raw.viaIndeed || mentionsIndeedOrigin(raw.originSite);

  const rejection = decideRejection({
    raw,
    viaIndeed,
    hardFlags: quality.hardFlags,
    relevant: relevance.relevant,
    relevanceReason: relevance.excluded_reason,
    usEligible: location.us_eligible,
    locationReason: location.reason,
    remoteType: remote.remote_type,
    remoteEvidence: remote.evidence,
    age,
    opts,
  });

  const sourceName = opts.sourceName(raw.source);
  return {
    id: sha1(`${raw.source}:${raw.sourceJobId ?? canonicalUrl}`),
    source: sourceName,
    source_id: raw.source,
    source_job_id: raw.sourceJobId,
    sources: [sourceName],

    title: raw.title.trim(),
    company: raw.company?.trim() || null,
    company_domain: companyDomain,

    location: raw.location?.trim() || null,
    remote_type: remote.remote_type,
    remote_scope: location.scope,
    remote_confidence: remote.confidence,
    remote_evidence: [...remote.evidence, ...remote.notes],
    us_eligible: location.us_eligible,

    employment_type: normalizeEmploymentType(raw.employmentType),

    salary_raw: salaryRaw,
    salary_min: salary?.min ?? null,
    salary_max: salary?.max ?? null,
    salary_currency: salary?.currency ?? null,
    salary_period: salary?.period ?? null,

    description,
    description_text: descriptionText,
    description_is_snippet: !!raw.descriptionIsSnippet,
    requirements: raw.requirements ?? [],
    benefits: raw.benefits ?? [],

    matched_keyword: relevance.matched_keyword,
    matched_keywords: relevance.matched_keywords,
    keyword_category: relevance.category,
    keyword_confidence: relevance.keyword_confidence,
    medical_role_score: relevance.medical_role_score,

    posted_at: date.postedAt,
    scraped_at: raw.fetchedAt,
    age_hours: age,
    date_confidence: date.confidence,

    job_url: jobUrl,
    apply_url: applyUrl,
    canonical_url: canonicalUrl,
    source_url: raw.sourceUrl ?? null,
    via_indeed: viaIndeed,

    ats_provider: ats?.provider ?? null,
    ats_job_id: ats?.jobId ?? null,
    listing_type: listingType,
    quality_flags: quality.flags,

    is_duplicate: false,
    duplicate_of: null,
    duplicate_count: 0,

    first_seen_at: null,
    last_seen_at: null,
    reposted_at: null,
    is_new: null,

    found_by: [...raw.foundBy],
    detail_fetched: !!raw.detailFetched,
    rejection,
  };
}

interface RejectionInput {
  raw: RawJob;
  viaIndeed: boolean;
  hardFlags: string[];
  relevant: boolean;
  relevanceReason: string | null;
  usEligible: boolean;
  locationReason: string | null;
  remoteType: string;
  remoteEvidence: string[];
  age: number | null;
  opts: NormalizeOptions;
}

/** First failing check wins, so each rejected job is counted under exactly one reason. */
function decideRejection(i: RejectionInput): RejectionReason | null {
  if ((i.opts.excludeIndeed ?? true) && i.viaIndeed) {
    return { code: 'indeed', detail: 'listing or application routes through Indeed' };
  }
  const invalid: string[] = i.hardFlags.filter((f) => f === 'missing_title' || f === 'invalid_job_url' || f === 'missing_employer');
  if (invalid.length) return { code: 'invalid', detail: invalid.join(', ') };
  const lowQuality = i.hardFlags.filter((f) => !invalid.includes(f));
  if (lowQuality.length) return { code: 'low_quality', detail: lowQuality.join(', ') };
  if (i.opts.excludeRepostAggregators && isJobBoardCompany(i.raw.company)) {
    return { code: 'low_quality', detail: `aggregator repost with hidden employer ("${i.raw.company}")` };
  }
  if (!i.relevant) return { code: 'irrelevant', detail: i.relevanceReason ?? 'no keyword match' };
  if (!i.usEligible) return { code: 'non_us', detail: i.locationReason ?? 'not available to US workers' };
  if (i.opts.remoteOnly && i.remoteType !== 'fully_remote') {
    return { code: 'not_remote', detail: `${i.remoteType}${i.remoteEvidence[0] ? `: ${i.remoteEvidence[0]}` : ''}` };
  }
  if (i.age !== null && i.age > i.opts.hoursOld) return { code: 'too_old', detail: `posted ${i.age}h ago (limit ${i.opts.hoursOld}h)` };
  if (i.age === null && !i.opts.includeUndated) return { code: 'too_old', detail: 'posting date unknown' };
  return null;
}

export function normalizeEmploymentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.replace(/_/g, ' ').trim().toLowerCase();
  if (!v) return null;
  if (/full[\s-]?time/.test(v)) return 'Full-time';
  if (/part[\s-]?time/.test(v)) return 'Part-time';
  if (/contract|contractor|freelance|1099|temporary|temp\b/.test(v)) return /temp/.test(v) ? 'Temporary' : 'Contract';
  if (/intern/.test(v)) return 'Internship';
  if (/per\s+diem|prn/.test(v)) return 'Per diem';
  return value.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}
