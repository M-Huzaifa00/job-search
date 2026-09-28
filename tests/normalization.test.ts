import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCompany } from '../src/core/normalization/company.ts';
import { ageHours, parseAbsoluteDate, parseRelativeDate, resolvePostedDate } from '../src/core/normalization/date.ts';
import { parseSalary } from '../src/core/normalization/salary.ts';
import { normalizeTitle } from '../src/core/normalization/title.ts';
import { canonicalizeUrl, detectAts, isIndeedUrl, isPublicHttpUrl, stripTracking } from '../src/core/normalization/url.ts';
import { parseRetryAfter } from '../src/http/client.ts';
import { detectBlockPage } from '../src/http/errors.ts';
import { NOW } from './helpers.ts';

describe('title normalization', () => {
  it('strips remote/location noise so equivalent titles compare equal', () => {
    assert.equal(normalizeTitle('Medical Billing Specialist - Remote'), 'medical billing specialist');
    assert.equal(normalizeTitle('REMOTE Medical Billing Specialist'), 'medical billing specialist');
    assert.equal(normalizeTitle('Medical Billing Specialist (100% Remote, US)'), 'medical billing specialist');
    assert.equal(normalizeTitle('Medical Billing Specialist - Texas'), 'medical billing specialist');
  });

  it('expands abbreviations and keeps level numerals', () => {
    assert.equal(normalizeTitle('Sr. Medical Coder'), 'senior medical coder');
    assert.equal(normalizeTitle('Medical Coder II - Remote'), 'medical coder 2');
    assert.equal(normalizeTitle('Billing & Collections Rep'), 'billing and collections representative');
    assert.notEqual(normalizeTitle('Medical Coder II'), normalizeTitle('Medical Coder III'));
  });

  it('drops requisition ids', () => {
    assert.equal(normalizeTitle('Medical Coder (Req #12345)'), 'medical coder');
    assert.equal(normalizeTitle('Medical Coder R-104233'), 'medical coder');
  });
});

describe('company normalization', () => {
  it('treats legal-suffix variants as the same employer', () => {
    const expected = 'abc healthcare';
    assert.equal(normalizeCompany('ABC Healthcare, Inc.'), expected);
    assert.equal(normalizeCompany('ABC Healthcare'), expected);
    assert.equal(normalizeCompany('ABC Healthcare Inc'), expected);
    assert.equal(normalizeCompany('ABC Health Care, LLC'), expected);
    assert.equal(normalizeCompany('The ABC Healthcare Corporation'), expected);
  });

  it('handles empty values', () => {
    assert.equal(normalizeCompany(null), '');
  });
});

describe('salary normalization', () => {
  const cases: [string, number | null, number | null, string | null, string | null][] = [
    ['$25/hour', 25, 25, 'USD', 'hour'],
    ['$55,000/year', 55000, 55000, 'USD', 'year'],
    ['$50k-$65k', 50000, 65000, 'USD', 'year'],
    ['$50-65k', 50000, 65000, 'USD', 'year'],
    ['$4,500/month', 4500, 4500, 'USD', 'month'],
    ['$37.45 - 57.29 per hour', 37.45, 57.29, 'USD', 'hour'],
    ['USD 140,000.00 - 170,000.00 per year', 140000, 170000, 'USD', 'year'],
    ['$16 - $20 an hour', 16, 20, 'USD', 'hour'],
    ['$2790 per week', 2790, 2790, 'USD', 'week'],
    ['Up to $60,000 a year', null, 60000, 'USD', 'year'],
    ['From $22 per hour', 22, null, 'USD', 'hour'],
    ['CA$60,000 - CA$70,000 annually', 60000, 70000, 'CAD', 'year'],
  ];
  for (const [raw, min, max, currency, period] of cases) {
    it(`parses "${raw}"`, () => {
      const s = parseSalary(raw)!;
      assert.ok(s, 'expected a salary');
      assert.equal(s.min, min);
      assert.equal(s.max, max);
      assert.equal(s.currency, currency);
      assert.equal(s.period, period);
    });
  }

  it('never invents a salary', () => {
    assert.equal(parseSalary(''), null);
    assert.equal(parseSalary('Competitive pay'), null);
    assert.equal(parseSalary(null), null);
  });

  it('does not mistake "401(k)" for money', () => {
    assert.equal(parseSalary('401(k) matching'), null);
  });
});

describe('posting-age parsing', () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

  it('parses relative text against the fetch time', () => {
    assert.deepEqual(parseRelativeDate('3 hours ago', NOW), { postedAt: at(3), confidence: 'exact' });
    assert.deepEqual(parseRelativeDate('16 minutes ago', NOW), { postedAt: new Date(NOW.getTime() - 16 * 60_000).toISOString(), confidence: 'exact' });
    assert.deepEqual(parseRelativeDate('Posted 2 days ago', NOW), { postedAt: at(48), confidence: 'estimated' });
    assert.deepEqual(parseRelativeDate('30+ days ago', NOW), { postedAt: at(720), confidence: 'estimated' });
    assert.deepEqual(parseRelativeDate('an hour ago', NOW), { postedAt: at(1), confidence: 'estimated' });
    assert.deepEqual(parseRelativeDate('Just posted', NOW), { postedAt: at(0), confidence: 'estimated' });
  });

  it('estimates "today" conservatively and maps "1 day ago" to the 24h boundary', () => {
    assert.equal(parseRelativeDate('Today', NOW)!.postedAt, at(12));
    assert.equal(parseRelativeDate('Today', NOW)!.confidence, 'estimated');
    assert.equal(parseRelativeDate('1 day ago', NOW)!.postedAt, at(24));
    assert.equal(parseRelativeDate('yesterday', NOW)!.postedAt, at(36));
  });

  it('parses absolute formats', () => {
    assert.deepEqual(parseAbsoluteDate('2026-09-28T10:00:00Z', NOW), { postedAt: '2026-09-28T10:00:00.000Z', confidence: 'exact' });
    assert.deepEqual(parseAbsoluteDate('Fri, 25 Sep 2026 07:06:34 GMT', NOW), { postedAt: '2026-09-25T07:06:34.000Z', confidence: 'exact' });
    assert.deepEqual(parseAbsoluteDate(1790600000, NOW), { postedAt: new Date(1790600000 * 1000).toISOString(), confidence: 'exact' });
    assert.deepEqual(parseAbsoluteDate('2026-09-21T12:55:11', NOW), { postedAt: '2026-09-21T12:55:11.000Z', confidence: 'exact' });
    assert.deepEqual(parseAbsoluteDate('2026-09-27', NOW), { postedAt: '2026-09-27T12:00:00.000Z', confidence: 'estimated' });
  });

  it('prefers precise relative text over a date-only value', () => {
    const r = resolvePostedDate({ postedAt: '2026-09-28', postedText: '16 minutes ago' }, NOW);
    assert.equal(r.confidence, 'exact');
    assert.equal(ageHours(r.postedAt, NOW), 0.3);
  });

  it('reports unknown dates honestly', () => {
    assert.deepEqual(resolvePostedDate({ postedText: 'recently' }, NOW), { postedAt: null, confidence: 'unknown' });
    assert.equal(ageHours(null, NOW), null);
  });

  it('clamps small future skews and rejects absurd dates', () => {
    assert.equal(parseAbsoluteDate(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW)!.postedAt, NOW.toISOString());
    assert.equal(parseAbsoluteDate('2099-01-01T00:00:00Z', NOW), null);
  });
});

describe('Indeed URL exclusion', () => {
  const indeed = [
    'https://www.indeed.com/viewjob?jk=abc123',
    'https://uk.indeed.com/jobs?q=billing',
    'https://indeed.co.uk/viewjob?jk=1',
    'https://apply.indeed.com/indeedapply/xpc',
    'https://to.indeed.com/aaabbb',
    'https://www.indeedjobs.com/acme/jobs/123',
    'https://example.com/redirect?url=https%3A%2F%2Fwww.indeed.com%2Fviewjob%3Fjk%3D1',
    'https://jobviewtrack.com/v2/abc?dest=https://www.indeed.com/rc/clk?jk=1',
  ];
  for (const u of indeed) it(`flags ${u}`, () => assert.equal(isIndeedUrl(u), true));

  const clean = ['https://www.linkedin.com/jobs/view/123', 'https://notindeed.com/job/1', 'https://boards.greenhouse.io/acme/jobs/1', 'https://www.simplyhired.com/job/abc'];
  for (const u of clean) it(`does not flag ${u}`, () => assert.equal(isIndeedUrl(u), false));
});

describe('URL canonicalisation and ATS detection', () => {
  it('removes tracking parameters but keeps meaningful ones', () => {
    assert.equal(canonicalizeUrl('https://www.linkedin.com/jobs/view/123/?trk=public_jobs&refId=x&utm_source=y'), 'https://linkedin.com/jobs/view/123');
    assert.equal(canonicalizeUrl('http://acme.com/careers?gh_jid=42&gh_src=li#apply'), 'https://acme.com/careers?gh_jid=42');
    assert.equal(stripTracking('https://jobs.lever.co/acme/uuid?lever-source=LinkedIn'), 'https://jobs.lever.co/acme/uuid');
  });

  it('detects common ATS providers and ids', () => {
    assert.deepEqual(detectAts('https://boards.greenhouse.io/acmehealth/jobs/4012345'), { provider: 'Greenhouse', jobId: '4012345', company: 'acmehealth' });
    assert.deepEqual(detectAts('https://jobs.lever.co/acme/1b2c3d4e-aaaa'), { provider: 'Lever', jobId: '1b2c3d4e-aaaa', company: 'acme' });
    assert.equal(detectAts('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Remote/Medical-Coder_R104233')?.jobId, 'R104233');
    assert.equal(detectAts('https://jobs.ashbyhq.com/acme/5f1e')?.provider, 'Ashby');
    assert.equal(detectAts('https://careers-acme.icims.com/jobs/12345/medical-coder/job')?.jobId, '12345');
    assert.equal(detectAts('https://www.linkedin.com/jobs/view/1'), null);
  });

  it('SSRF guard only allows public http(s) URLs', () => {
    assert.equal(isPublicHttpUrl('https://example.com/job'), true);
    for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.1/', 'file:///etc/passwd', 'http://example.com:8080/', 'http://[::1]/', 'http://user:pw@example.com/']) {
      assert.equal(isPublicHttpUrl(bad), false, bad);
    }
  });
});

describe('HTTP helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    assert.equal(parseRetryAfter('5'), 5000);
    assert.equal(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())! > 8000, true);
    assert.equal(parseRetryAfter(null), undefined);
  });

  it('recognises bot-challenge pages', () => {
    const h = new Headers();
    assert.match(detectBlockPage(403, h, '<html><head><title>Just a moment...</title></head></html>')!, /Cloudflare/);
    assert.match(detectBlockPage(403, h, '{"url":"https://geo.captcha-delivery.com/interstitial/"}')!, /DataDome/);
    assert.equal(detectBlockPage(200, h, '<html><title>Jobs</title></html>'), null);
  });
});
