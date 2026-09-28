import type { NormalizedJob, SourceId } from '../../models/job.ts';
import { jaccard, shingleSimilarity, tokenSet } from '../../utils/text.ts';
import { normalizeCompany } from '../normalization/company.ts';
import { normalizeTitle } from '../normalization/title.ts';
import { isJobBoardUrl, isRedirectTracker } from '../normalization/url.ts';

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Higher = more trustworthy/original listing. Direct boards beat aggregators. */
const SOURCE_PRIORITY: Partial<Record<SourceId, number>> = {
  linkedin: 6,
  dice: 6,
  remotive: 5,
  jobicy: 5,
  remoteok: 5,
  simplyhired: 3,
  canada_job_bank: 3,
  careerjet: 2,
  jooble: 2,
};

function hasEmployerApplyUrl(j: NormalizedJob): boolean {
  return !!j.apply_url && !isJobBoardUrl(j.apply_url) && !isRedirectTracker(j.apply_url);
}

function primaryScore(j: NormalizedJob): number {
  return (
    (j.ats_provider ? 100 : 0) +
    (hasEmployerApplyUrl(j) ? 50 : 0) +
    (j.date_confidence === 'exact' ? 20 : j.date_confidence === 'estimated' ? 10 : 0) +
    (j.detail_fetched ? 10 : 0) +
    (j.description_is_snippet ? 0 : Math.min(20, (j.description_text?.length ?? 0) / 500)) +
    (SOURCE_PRIORITY[j.source_id] ?? 1)
  );
}

function descLong(j: NormalizedJob, min: number): boolean {
  return !j.description_is_snippet && (j.description_text?.length ?? 0) >= min;
}

/** Decides whether two same-employer listings with the same normalized title are the same position. */
function sameTitleCompatible(a: NormalizedJob, b: NormalizedJob): boolean {
  if (descLong(a, 400) && descLong(b, 400)) {
    const sim = shingleSimilarity(a.description_text!, b.description_text!);
    // Same title but clearly different postings (e.g. separate state-specific requisitions).
    if (sim < 0.2 && a.remote_scope !== b.remote_scope) return false;
  }
  return true;
}

export interface DedupResult {
  unique: NormalizedJob[];
  duplicates: NormalizedJob[];
}

export interface DedupKeys {
  company: string;
  title: string;
}

export function dedupKeys(j: Pick<NormalizedJob, 'company' | 'title'>): DedupKeys {
  return { company: normalizeCompany(j.company), title: normalizeTitle(j.title) };
}

/**
 * Cross-source duplicate detection. Signals (any one merges two listings):
 *  1. same canonical application URL
 *  2. same ATS provider + ATS job id
 *  3. same normalized employer + normalized title (unless descriptions prove they differ)
 *  4. same employer + similar title + near-identical description
 */
export function deduplicate(jobs: NormalizedJob[]): DedupResult {
  const n = jobs.length;
  const uf = new UnionFind(n);
  const keys = jobs.map(dedupKeys);

  const byUrl = new Map<string, number>();
  const byAts = new Map<string, number>();
  jobs.forEach((j, i) => {
    const u = j.canonical_url;
    if (u) {
      const prev = byUrl.get(u);
      if (prev !== undefined) uf.union(prev, i);
      else byUrl.set(u, i);
    }
    if (j.ats_provider && j.ats_job_id) {
      const k = `${j.ats_provider}|${j.ats_job_id}|${keys[i].company}`;
      const prev = byAts.get(k);
      if (prev !== undefined) uf.union(prev, i);
      else byAts.set(k, i);
    }
  });

  const byCompany = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (!k.company) return;
    const list = byCompany.get(k.company) ?? [];
    list.push(i);
    byCompany.set(k.company, list);
  });

  const titleTokens = keys.map((k) => tokenSet(k.title));
  for (const idxs of byCompany.values()) {
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        const a = idxs[x];
        const b = idxs[y];
        if (uf.find(a) === uf.find(b)) continue;
        if (keys[a].title && keys[a].title === keys[b].title) {
          if (sameTitleCompatible(jobs[a], jobs[b])) uf.union(a, b);
          continue;
        }
        if (jaccard(titleTokens[a], titleTokens[b]) >= 0.6 && descLong(jobs[a], 300) && descLong(jobs[b], 300)) {
          if (shingleSimilarity(jobs[a].description_text!, jobs[b].description_text!) >= 0.75) uf.union(a, b);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }

  const unique: NormalizedJob[] = [];
  const duplicates: NormalizedJob[] = [];
  for (const members of groups.values()) {
    const group = members.map((i) => jobs[i]);
    group.sort((a, b) => primaryScore(b) - primaryScore(a));
    const merged = mergeGroup(group);
    unique.push(merged);
    for (const dup of group.slice(1)) duplicates.push({ ...dup, is_duplicate: true, duplicate_of: merged.id });
  }
  return { unique, duplicates };
}

function mergeGroup(group: NormalizedJob[]): NormalizedJob {
  const primary = { ...group[0] };
  if (group.length === 1) return primary;

  primary.sources = unique(group.flatMap((j) => j.sources));
  primary.matched_keywords = unique(group.flatMap((j) => j.matched_keywords));
  primary.found_by = unique(group.flatMap((j) => j.found_by));
  primary.remote_evidence = unique(group.flatMap((j) => j.remote_evidence)).slice(0, 12);
  primary.quality_flags = unique(primary.quality_flags);
  primary.duplicate_count = group.length - 1;
  primary.remote_confidence = Math.max(...group.map((j) => j.remote_confidence));
  primary.keyword_confidence = Math.max(...group.map((j) => j.keyword_confidence));
  primary.medical_role_score = Math.max(...group.map((j) => j.medical_role_score));

  // Most precise date; among equally precise dates the earliest is the original posting.
  const dated = group.filter((j) => j.posted_at);
  const rank = (c: string) => (c === 'exact' ? 2 : c === 'estimated' ? 1 : 0);
  dated.sort((a, b) => rank(b.date_confidence) - rank(a.date_confidence) || Date.parse(a.posted_at!) - Date.parse(b.posted_at!));
  if (dated[0]) {
    primary.posted_at = dated[0].posted_at;
    primary.age_hours = dated[0].age_hours;
    primary.date_confidence = dated[0].date_confidence;
  }

  // Strongest application URL: employer ATS > employer site > board listing.
  const withEmployerUrl = group.filter(hasEmployerApplyUrl).sort((a, b) => Number(!!b.ats_provider) - Number(!!a.ats_provider));
  if (withEmployerUrl[0]) {
    primary.apply_url = withEmployerUrl[0].apply_url;
    primary.canonical_url = withEmployerUrl[0].canonical_url;
    primary.ats_provider = withEmployerUrl[0].ats_provider ?? primary.ats_provider;
    primary.ats_job_id = withEmployerUrl[0].ats_job_id ?? primary.ats_job_id;
  }

  const longest = group.filter((j) => !j.description_is_snippet && j.description_text).sort((a, b) => b.description_text!.length - a.description_text!.length)[0];
  if (longest && (primary.description_is_snippet || !primary.description_text)) {
    primary.description = longest.description;
    primary.description_text = longest.description_text;
    primary.description_is_snippet = false;
  }
  if (primary.salary_min === null && primary.salary_max === null) {
    const withSalary = group.find((j) => j.salary_min !== null || j.salary_max !== null);
    if (withSalary) {
      primary.salary_raw = withSalary.salary_raw;
      primary.salary_min = withSalary.salary_min;
      primary.salary_max = withSalary.salary_max;
      primary.salary_currency = withSalary.salary_currency;
      primary.salary_period = withSalary.salary_period;
    }
  }
  primary.company_domain ??= group.find((j) => j.company_domain)?.company_domain ?? null;
  primary.employment_type ??= group.find((j) => j.employment_type)?.employment_type ?? null;
  return primary;
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
