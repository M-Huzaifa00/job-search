import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deduplicate } from '../src/core/dedup/dedup.ts';
import { rankJobs } from '../src/core/ranking/rank.ts';
import { hoursAgo, normalize, rawJob } from './helpers.ts';

describe('deduplication', () => {
  it('merges the same role posted on several boards (normalized title + company)', () => {
    const a = normalize(rawJob({ source: 'linkedin', sourceJobId: '1', title: 'Medical Billing Specialist - Remote', company: 'ABC Healthcare, Inc.' }));
    const b = normalize(
      rawJob({ source: 'jobicy', sourceJobId: '2', title: 'REMOTE Medical Billing Specialist', company: 'ABC Healthcare', jobUrl: 'https://jobicy.com/jobs/2', remoteHints: [{ kind: 'remote_only_board', detail: 'x' }] }),
    );
    const c = normalize(rawJob({ source: 'dice', sourceJobId: '3', title: 'Medical Billing Specialist', company: 'ABC Healthcare Inc', jobUrl: 'https://www.dice.com/job-detail/3' }));
    const { unique, duplicates } = deduplicate([a, b, c]);
    assert.equal(unique.length, 1);
    assert.equal(duplicates.length, 2);
    assert.deepEqual([...unique[0].sources].sort(), ['Dice', 'Jobicy', 'LinkedIn']);
    assert.equal(unique[0].duplicate_count, 2);
    assert.ok(duplicates.every((d) => d.is_duplicate && d.duplicate_of === unique[0].id));
  });

  it('merges listings that share the same employer application URL', () => {
    const apply = 'https://boards.greenhouse.io/acmehealth/jobs/4012345?gh_src=linkedin';
    const a = normalize(rawJob({ sourceJobId: '1', title: 'Billing Specialist', company: 'Acme Health', applyUrl: apply }));
    const b = normalize(rawJob({ source: 'careerjet', sourceJobId: '2', title: 'Medical Billing Rep', company: 'Acme Health Partners', applyUrl: 'https://boards.greenhouse.io/acmehealth/jobs/4012345', jobUrl: 'https://jobviewtrack.com/v2/xyz' }));
    const { unique } = deduplicate([a, b]);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].ats_provider, 'Greenhouse');
  });

  it('prefers the employer ATS URL over an aggregator listing', () => {
    const board = normalize(rawJob({ source: 'linkedin', sourceJobId: '1', company: 'Acme Health' }));
    const ats = normalize(rawJob({ source: 'careerjet', sourceJobId: '2', company: 'Acme Health', jobUrl: 'https://jobviewtrack.com/v2/xyz', applyUrl: 'https://jobs.lever.co/acme/abc-123' }));
    const { unique } = deduplicate([board, ats]);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].apply_url, 'https://jobs.lever.co/acme/abc-123');
    assert.equal(unique[0].ats_provider, 'Lever');
  });

  it('keeps different employers separate', () => {
    const a = normalize(rawJob({ sourceJobId: '1', company: 'Acme Health' }));
    const b = normalize(rawJob({ sourceJobId: '2', company: 'Beta Medical Group' }));
    assert.equal(deduplicate([a, b]).unique.length, 2);
  });

  it('keeps same-title postings apart when descriptions prove they are different requisitions', () => {
    const longA = 'Texas team. '.repeat(10) + 'Process hospital facility claims for our Texas facilities, UB-04 inpatient billing, Medicaid managed care follow up. '.repeat(6);
    const longB = 'Florida office. '.repeat(10) + 'Handle professional physician billing for orthopedic surgery practices in Florida including CMS-1500 claims and workers compensation. '.repeat(6);
    const a = normalize(rawJob({ sourceJobId: '1', company: 'Acme Health', location: 'Remote - Texas', descriptionText: longA + ' fully remote position' }));
    const b = normalize(rawJob({ sourceJobId: '2', company: 'Acme Health', location: 'Remote - Florida', descriptionText: longB + ' fully remote position' }));
    assert.equal(deduplicate([a, b]).unique.length, 2);
  });

  it('merges near-identical descriptions with similar titles from the same employer', () => {
    const desc = 'Acme Health is seeking a remote medical billing professional to manage claim submission, payer follow-up, denial management and patient statements. '.repeat(5);
    const a = normalize(rawJob({ sourceJobId: '1', company: 'Acme Health', title: 'Medical Billing Specialist I', descriptionText: desc }));
    const b = normalize(rawJob({ source: 'dice', sourceJobId: '2', company: 'Acme Health', title: 'Medical Billing Specialist', descriptionText: desc, jobUrl: 'https://www.dice.com/job-detail/2' }));
    assert.equal(deduplicate([a, b]).unique.length, 1);
  });
});

describe('ranking', () => {
  it('orders by recency, then remote confidence, then relevance; undated last', () => {
    const newer = normalize(rawJob({ sourceJobId: '1', company: 'A', postedAt: hoursAgo(1) }));
    const older = normalize(rawJob({ sourceJobId: '2', company: 'B', postedAt: hoursAgo(10) }));
    const undated = normalize(rawJob({ sourceJobId: '3', company: 'C', postedAt: null }));
    const ranked = rankJobs([undated, older, newer]);
    assert.deepEqual(
      ranked.map((j) => j.company),
      ['A', 'B', 'C'],
    );
  });
});
