import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../src/db/database.ts';
import { Repository } from '../src/db/repository.ts';
import { CSV_COLUMNS, csvCell, jobsToCsv } from '../src/output/csv.ts';
import { NOW, hoursAgo, normalize, rawJob } from './helpers.ts';

describe('CSV output', () => {
  it('contains every required column', () => {
    const required = ['source', 'sources', 'title', 'company', 'location', 'remote_type', 'remote_scope', 'employment_type', 'salary_raw', 'salary_min', 'salary_max', 'salary_currency', 'matched_keyword', 'matched_keywords', 'posted_at', 'age_hours', 'description', 'job_url', 'apply_url', 'ats_provider', 'listing_type'];
    for (const col of required) assert.ok((CSV_COLUMNS as string[]).includes(col), col);
  });

  it('escapes quotes, commas and newlines and guards formulas', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell(['a', 'b']), 'a; b');
    assert.equal(csvCell(null), '');
  });

  it('renders one header row plus one row per job', () => {
    const csv = jobsToCsv([normalize(rawJob())], { bom: true });
    assert.ok(csv.startsWith('﻿source,sources,title'));
    assert.equal(csv.trim().split('\r\n').length, 2);
  });
});

describe('persistence and repost detection', () => {
  it('tracks first_seen_at / last_seen_at and marks reposts', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const first = normalize(rawJob({ sourceJobId: 'abc', postedAt: hoursAgo(5) }));
    repo.createRun('run_1', { titles: ['x'], country: 'US', remoteOnly: true, hoursOld: 24 }, NOW.toISOString());
    repo.upsertJobs([first], [], 'run_1', NOW);
    assert.equal(first.is_new, true);
    const firstId = first.id;

    // Same listing seen again a day later.
    const later = new Date(NOW.getTime() + 24 * 3_600_000);
    const again = normalize(rawJob({ sourceJobId: 'abc', postedAt: hoursAgo(5) }));
    repo.upsertJobs([again], [], 'run_2', later);
    assert.equal(again.is_new, false);
    assert.equal(again.id, firstId);
    assert.equal(again.first_seen_at, NOW.toISOString());
    assert.equal(again.reposted_at, null);

    // Same employer + title reposted on another board with a fresh posting date.
    const repost = normalize(
      rawJob({ source: 'dice', sourceJobId: 'zzz', jobUrl: 'https://www.dice.com/job-detail/zzz', postedAt: new Date(later.getTime() - 3_600_000).toISOString(), fetchedAt: later.toISOString() }),
      { now: later },
    );
    repo.upsertJobs([repost], [], 'run_3', later);
    assert.equal(repost.id, firstId);
    assert.equal(repost.is_new, false);
    assert.ok(repost.reposted_at);

    assert.equal(repo.listJobs({ seenWithinHours: 24 * 400 }).length, 1);
  });

  it('caches detail payloads with a TTL', () => {
    const repo = new Repository(openDatabase(':memory:'));
    repo.setDetail('linkedin:1', { descriptionHtml: '<p>x</p>' }, 1);
    assert.deepEqual(repo.getDetail('linkedin:1'), { descriptionHtml: '<p>x</p>' });
    assert.equal(repo.getDetail('linkedin:2'), null);
  });
});
