import { DEFAULT_TITLES } from '../src/config/keywords.ts';
import { normalizeJob, type NormalizeOptions } from '../src/core/pipeline/normalize.ts';
import type { NormalizedJob, RawJob } from '../src/models/job.ts';
import { sourceName } from '../src/sources/registry.ts';

export const NOW = new Date('2026-09-28T15:00:00Z');

export function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

export function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  const id = overrides.sourceJobId ?? String(Math.floor(Math.random() * 1e9));
  return {
    source: 'linkedin',
    sourceJobId: id,
    title: 'Medical Billing Specialist',
    company: 'Example Health',
    location: 'United States',
    descriptionText:
      'Example Health is hiring a remote Medical Billing Specialist. Submit claims to Medicare, Medicaid and commercial payers, work denials, post payments and review EOBs. Knowledge of CPT and ICD-10 coding required. This is a fully remote position open to candidates anywhere in the United States.',
    postedAt: hoursAgo(3),
    fetchedAt: NOW.toISOString(),
    jobUrl: `https://www.linkedin.com/jobs/view/${id}`,
    applyUrl: null,
    remoteHints: [],
    countryHint: 'US',
    foundBy: ['medical billing'],
    ...overrides,
  };
}

export function normalize(raw: RawJob, opts: Partial<NormalizeOptions> = {}): NormalizedJob {
  return normalizeJob(raw, {
    terms: DEFAULT_TITLES,
    hoursOld: 24,
    remoteOnly: true,
    includeUndated: true,
    excludeRepostAggregators: true,
    now: NOW,
    sourceName,
    ...opts,
  });
}
