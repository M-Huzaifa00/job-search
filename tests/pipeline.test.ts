import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidFinalJob } from '../src/core/pipeline/finalFilter.ts';
import { hoursAgo, normalize, rawJob } from './helpers.ts';

const FINAL = { hoursOld: 24, remoteOnly: true, includeUndated: true };

describe('end-to-end classification of a single listing', () => {
  it('accepts a genuine fully-remote US medical billing job', () => {
    const job = normalize(rawJob({ title: '100% Remote Medical Billing Specialist - United States' }));
    assert.equal(job.rejection, null);
    assert.equal(job.remote_type, 'fully_remote');
    assert.equal(job.remote_scope, 'US nationwide');
    assert.ok(job.age_hours! <= 24);
    assert.ok(isValidFinalJob(job, FINAL).ok);
  });

  it('rejects "Remote Medical Biller - must work onsite every Tuesday" as not remote', () => {
    const job = normalize(rawJob({ title: 'Remote Medical Biller - must work onsite every Tuesday', descriptionText: 'Medical biller for a physician practice. Medicare and Medicaid claims.' }));
    assert.equal(job.remote_type, 'hybrid');
    assert.equal(job.rejection?.code, 'not_remote');
  });

  it('rejects "Medical Coding Specialist - Toronto Remote" as non-US', () => {
    const job = normalize(rawJob({ title: 'Medical Coding Specialist - Toronto Remote', location: null, countryHint: null, descriptionText: 'ICD-10 and CPT coding for outpatient records.' }));
    assert.equal(job.rejection?.code, 'non_us');
  });

  it('rejects "Senior Python Coder - Remote US" as a keyword mismatch', () => {
    const job = normalize(rawJob({ title: 'Senior Python Coder - Remote US', company: 'Acme Software', descriptionText: 'Build Python APIs. Fully remote across the US.' }));
    assert.equal(job.rejection?.code, 'irrelevant');
  });

  it('rejects listings whose URLs route through Indeed', () => {
    assert.equal(normalize(rawJob({ applyUrl: 'https://www.indeed.com/viewjob?jk=123' })).rejection?.code, 'indeed');
    assert.equal(normalize(rawJob({ jobUrl: 'https://www.indeed.com/viewjob?jk=123' })).rejection?.code, 'indeed');
    assert.equal(normalize(rawJob({ viaIndeed: true })).rejection?.code, 'indeed');
    assert.equal(normalize(rawJob({ originSite: 'Indeed' })).rejection?.code, 'indeed');
  });

  it('keeps Indeed-routed listings when excludeIndeed is off', () => {
    const opts = { excludeIndeed: false };
    assert.equal(normalize(rawJob({ viaIndeed: true }), opts).rejection, null);
    assert.equal(normalize(rawJob({ originSite: 'Indeed' }), opts).rejection, null);
    const job = normalize(rawJob({ applyUrl: 'https://www.indeed.com/viewjob?jk=123' }), opts);
    assert.equal(job.rejection, null);
    assert.equal(job.apply_url, 'https://www.indeed.com/viewjob?jk=123');
    assert.equal(job.via_indeed, true);
    assert.equal(normalize(rawJob(), opts).via_indeed, false);
  });

  it('rejects jobs older than the requested window but keeps them for a wider window', () => {
    const raw = rawJob({ postedAt: hoursAgo(30) });
    assert.equal(normalize(raw).rejection?.code, 'too_old');
    assert.equal(normalize(raw, { hoursOld: 48 }).rejection, null);
  });

  it('keeps undated jobs only when allowed', () => {
    const raw = rawJob({ postedAt: null });
    assert.equal(normalize(raw).date_confidence, 'unknown');
    assert.equal(normalize(raw).rejection, null);
    assert.equal(normalize(raw, { includeUndated: false }).rejection?.code, 'too_old');
  });

  it('rejects aggregator reposts that hide the employer and listings without an employer', () => {
    assert.equal(normalize(rawJob({ company: 'Lensa' })).rejection?.code, 'low_quality');
    assert.equal(normalize(rawJob({ company: 'Confidential' })).rejection?.code, 'invalid');
  });

  it('rejects scam-like listings', () => {
    const job = normalize(rawJob({ descriptionText: 'Medical billing from home! Earn $500 per day. Contact us on Telegram. Fully remote in the United States.' }));
    assert.equal(job.rejection?.code, 'low_quality');
  });

  it('distinguishes staffing agencies without rejecting them', () => {
    const job = normalize(rawJob({ company: 'Robert Half' }));
    assert.equal(job.listing_type, 'staffing_agency');
    assert.equal(job.rejection, null);
  });

  it('extracts salary, employment type and ATS provider', () => {
    const job = normalize(rawJob({ salaryRaw: '$22 - $26 an hour', employmentType: 'FULL_TIME', applyUrl: 'https://boards.greenhouse.io/examplehealth/jobs/123?gh_src=abc' }));
    assert.equal(job.salary_min, 22);
    assert.equal(job.salary_max, 26);
    assert.equal(job.salary_period, 'hour');
    assert.equal(job.employment_type, 'Full-time');
    assert.equal(job.ats_provider, 'Greenhouse');
    assert.equal(job.apply_url, 'https://boards.greenhouse.io/examplehealth/jobs/123');
    assert.equal(job.listing_type, 'direct_employer');
  });
});

describe('strict final filter', () => {
  it('catches a job that slipped through with a hybrid remote type', () => {
    const job = { ...normalize(rawJob()), remote_type: 'hybrid' as const };
    const v = isValidFinalJob(job, FINAL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => r.includes('hybrid')));
  });

  it('catches Indeed URLs, bad URLs, missing employers and stale dates', () => {
    const base = normalize(rawJob());
    assert.equal(isValidFinalJob({ ...base, apply_url: 'https://www.indeed.com/viewjob?jk=1' }, FINAL).ok, false);
    assert.equal(isValidFinalJob({ ...base, job_url: 'not a url' }, FINAL).ok, false);
    assert.equal(isValidFinalJob({ ...base, company: null }, FINAL).ok, false);
    assert.equal(isValidFinalJob({ ...base, age_hours: 50 }, FINAL).ok, false);
    assert.equal(isValidFinalJob({ ...base, us_eligible: false }, FINAL).ok, false);
    assert.equal(isValidFinalJob({ ...base, matched_keywords: [] }, FINAL).ok, false);
  });

  it('allows Indeed URLs when excludeIndeed is off', () => {
    const job = { ...normalize(rawJob()), apply_url: 'https://www.indeed.com/viewjob?jk=1' };
    assert.equal(isValidFinalJob(job, { ...FINAL, excludeIndeed: false }).ok, true);
  });
});
