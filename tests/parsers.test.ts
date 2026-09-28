import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseJobBankFeed } from '../src/sources/canadaJobBank/parse.ts';
import { parseCareerjet } from '../src/sources/careerjet/parse.ts';
import { parseDiceSearch } from '../src/sources/dice/parse.ts';
import { parseJobicy } from '../src/sources/jobicy/parse.ts';
import { parseJooble } from '../src/sources/jooble/parse.ts';
import { parseLinkedInDetail, parseLinkedInSearch } from '../src/sources/linkedin/parse.ts';
import { parseRemoteOk } from '../src/sources/remoteok/parse.ts';
import { parseRemotive } from '../src/sources/remotive/parse.ts';
import { extractJobPostingJsonLd, jobPostingToRaw } from '../src/sources/shared/jsonld.ts';
import { looseKeywordMatch } from '../src/sources/shared/keywordFilter.ts';
import { parseSimplyHiredSearch, simplyHiredJobToRaw } from '../src/sources/simplyhired/parse.ts';

const CTX = { fetchedAt: '2026-09-28T15:00:00.000Z', keyword: 'medical billing', sourceUrl: 'https://example.test/search' };

// Structure mirrors the live /jobs-guest/jobs/api/seeMoreJobPostings/search response.
const LINKEDIN_SEARCH = `<!DOCTYPE html>
<li>
  <div class="base-card relative w-full base-card--link base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:4471510235">
    <a class="base-card__full-link absolute" href="https://www.linkedin.com/jobs/view/billing-specialist-at-big-sky-iv-care-4471510235?position=1&amp;pageNum=0&amp;refId=abc&amp;trackingId=def"><span class="sr-only">Billing Specialist</span></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">   Billing Specialist   </h3>
      <h4 class="base-search-card__subtitle"><a class="hidden-nested-link" href="https://www.linkedin.com/company/big-sky-iv-care?trk=public_jobs">  Big Sky IV Care </a></h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">Chicago, IL</span>
        <span class="job-search-card__salary-info">$20.00/hr - $24.00/hr</span>
        <time class="job-search-card__listdate--new" datetime="2026-09-28">16 minutes ago</time>
      </div>
    </div>
  </div>
</li>
<li>
  <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4471501527">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/medical-coder-at-acme-4471501527?position=2"></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">Medical Coder</h3>
      <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/acme">Acme Health</a></h4>
      <div class="base-search-card__metadata"><span class="job-search-card__location">United States</span><time datetime="2026-09-27">1 day ago</time></div>
    </div>
  </div>
</li>`;

const LINKEDIN_DETAIL = `<section class="top-card-layout">
  <h2 class="top-card-layout__title topcard__title">Billing &amp; Collections Representative II</h2>
  <div class="topcard__flavor-row">
    <span class="topcard__flavor"><a class="topcard__org-name-link" href="#">Rady Children's Hospital-San Diego</a></span>
    <span class="topcard__flavor topcard__flavor--bullet">San Diego, CA</span>
  </div>
  <div class="topcard__flavor-row"><span class="posted-time-ago__text topcard__flavor--metadata">22 hours ago</span></div>
  <code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/4471303209?url=https%3A%2F%2Fcareers%2Erchsd%2Eorg%2Fjobs%2F123%3Fsource%3Dlinkedin&urlHash=abc"--></code>
</section>
<div class="description__text description__text--rich"><section class="show-more-less-html"><div class="show-more-less-html__markup"><strong>Job Summary</strong><br>Resolve outstanding balances from all payors, including Medi-Cal. This is a fully remote position.</div></section></div>
<ul class="description__job-criteria-list">
  <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Not Applicable</span></li>
  <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Full-time</span></li>
  <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Industries</h3><span class="description__job-criteria-text">Hospitals and Health Care</span></li>
</ul>`;

describe('LinkedIn parser', () => {
  it('parses search cards', () => {
    const cards = parseLinkedInSearch(LINKEDIN_SEARCH);
    assert.equal(cards.length, 2);
    assert.deepEqual(cards[0], {
      id: '4471510235',
      title: 'Billing Specialist',
      company: 'Big Sky IV Care',
      companyUrl: 'https://www.linkedin.com/company/big-sky-iv-care',
      location: 'Chicago, IL',
      postedDate: '2026-09-28',
      postedText: '16 minutes ago',
      salary: '$20.00/hr - $24.00/hr',
      url: 'https://www.linkedin.com/jobs/view/4471510235',
    });
    assert.equal(cards[1].postedText, '1 day ago');
  });

  it('parses the job detail page including the off-site apply URL', () => {
    const d = parseLinkedInDetail(LINKEDIN_DETAIL);
    assert.equal(d.title, 'Billing & Collections Representative II');
    assert.equal(d.company, "Rady Children's Hospital-San Diego");
    assert.equal(d.location, 'San Diego, CA');
    assert.equal(d.postedText, '22 hours ago');
    assert.equal(d.employmentType, 'Full-time');
    assert.equal(d.industries, 'Hospitals and Health Care');
    assert.equal(d.applyUrl, 'https://careers.rchsd.org/jobs/123?source=linkedin');
    assert.match(d.descriptionHtml!, /fully remote position/);
  });
});

// Structure mirrors the live https://www.dice.com/jobs server-rendered cards.
const DICE_SEARCH = `<div role="list"><div role="listitem"><div data-id="4f625bc6" data-job-guid="298d06ae-58c8-41ae-ac92-4711734d8544" data-testid="job-card" role="article">
  <a data-testid="job-search-job-card-link" href="/job-detail/298d06ae-58c8-41ae-ac92-4711734d8544"> </a>
  <a href="/company-profile/x"><p class="mb-0 line-clamp-1 text-sm" data-testid="job-card-company-name">Machinify</p></a>
  <a data-testid="job-search-job-detail-link" aria-label="Revenue Cycle Analyst" href="/job-detail/298d06ae-58c8-41ae-ac92-4711734d8544">Revenue Cycle Analyst</a>
  <p class="mb-0 text-sm font-normal text-foreground-light">Remote<!-- --> • <!-- -->Today</p>
  <div><p id="employmentType-label">Full-time</p></div><div><p id="salary-label">USD 140,000.00 - 170,000.00 per year</p></div>
</div></div></div>`;

describe('Dice parser', () => {
  it('parses search cards', () => {
    const [c] = parseDiceSearch(DICE_SEARCH);
    assert.equal(c.guid, '298d06ae-58c8-41ae-ac92-4711734d8544');
    assert.equal(c.title, 'Revenue Cycle Analyst');
    assert.equal(c.company, 'Machinify');
    assert.equal(c.location, 'Remote');
    assert.equal(c.postedText, 'Today');
    assert.equal(c.employmentType, 'Full-time');
    assert.equal(c.salary, 'USD 140,000.00 - 170,000.00 per year');
    assert.equal(c.url, 'https://www.dice.com/job-detail/298d06ae-58c8-41ae-ac92-4711734d8544');
  });
});

describe('schema.org JobPosting JSON-LD', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
  <script type="application/ld+json" id="jobDetailStructuredData">{ "@context": "https://schema.org", "@type": "JobPosting", "title": "Senior Healthcare Data Analyst",
    "description": "&lt;p&gt;Remote role&lt;/p&gt;", "datePosted": "2026-09-27T20:52:55.000Z", "hiringOrganization": {"@type":"Organization","name":"Machinify"},
    "applicantLocationRequirements": {"@type":"Country","name":"USA"}, "jobLocationType": "TELECOMMUTE", "employmentType": "FULL_TIME",
    "baseSalary": {"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","minValue":60000,"maxValue":70000,"unitText":"YEAR"}} }</script></head></html>`;

  it('extracts and maps the JobPosting block', () => {
    const ld = extractJobPostingJsonLd(html)!;
    assert.ok(ld);
    const r = jobPostingToRaw(ld);
    assert.equal(r.title, 'Senior Healthcare Data Analyst');
    assert.equal(r.company, 'Machinify');
    assert.equal(r.postedAt, '2026-09-27T20:52:55.000Z');
    assert.deepEqual(r.applicantLocations, ['USA']);
    assert.equal(r.remoteHints?.[0].kind, 'structured_remote');
    assert.equal(r.descriptionHtml, '<p>Remote role</p>');
    assert.deepEqual(r.salary, { min: 60000, max: 70000, currency: 'USD', period: 'year' });
  });
});

describe('API/feed parsers', () => {
  it('RemoteOK skips the legal-notice element', () => {
    const jobs = parseRemoteOk(
      [
        { legal: 'API Terms' } as never,
        { id: '1137434', epoch: 1790438426, company: 'SIHO Insurance Services ', position: 'Medical Billing Specialist', tags: ['medical'], description: '<p>x</p>', location: 'United States', url: 'https://remoteOK.com/remote-jobs/x-1137434', apply_url: 'https://remoteOK.com/remote-jobs/x-1137434', salary_min: 0, salary_max: 0 },
      ],
      CTX,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].company, 'SIHO Insurance Services');
    assert.equal(jobs[0].jobUrl, 'https://remoteok.com/remote-jobs/x-1137434');
    assert.equal(jobs[0].applyUrl, null);
    assert.equal(jobs[0].salary, null);
    assert.equal(jobs[0].remoteHints[0].kind, 'remote_only_board');
  });

  it('Remotive maps candidate_required_location', () => {
    const [j] = parseRemotive({ jobs: [{ id: 1, url: 'https://remotive.com/remote-jobs/x-1', title: 'Medical Coder', company_name: 'Acme', publication_date: '2026-09-28T10:00:00', candidate_required_location: 'USA', job_type: 'full_time' }] }, CTX);
    assert.deepEqual(j.applicantLocations, ['USA']);
    assert.equal(j.postedAt, '2026-09-28T10:00:00');
  });

  it('Jobicy maps salary fields', () => {
    const [j] = parseJobicy(
      { jobs: [{ id: 153607, url: 'https://jobicy.com/jobs/153607', jobTitle: 'Billing & Follow-Up Specialist', companyName: 'BetterHelp', jobGeo: 'USA', jobType: ['Full-Time'], pubDate: '2026-09-18T14:42:58+00:00', salaryMin: 33, salaryMax: 38, salaryCurrency: 'USD', salaryPeriod: 'hourly' }] },
      { ...CTX, geoFiltered: true },
    );
    assert.deepEqual(j.salary, { min: 33, max: 38, currency: 'USD', period: 'hour' });
    assert.equal(j.countryHint, 'US');
  });

  it('CareerJet keeps tracker URL, snippet flag and salary', () => {
    const [j] = parseCareerjet(
      { type: 'JOBS', hits: 1, pages: 1, jobs: [{ title: 'Remote Medical Coder', company: 'Intermountain Health', locations: 'Billings, MT', date: 'Sun, 27 Sep 2026 07:42:57 GMT', url: 'https://jobviewtrack.com/v2/abc', description: 'Remote <b>medical</b> coding', salary: '$37.45 - 57.29 per hour', salary_min: '37.45', salary_max: '57.29', salary_type: 'H', salary_currency_code: 'USD', site: '' }] },
      CTX,
    );
    assert.equal(j.descriptionIsSnippet, true);
    assert.deepEqual(j.salary, { min: 37.45, max: 57.29, currency: 'USD', period: 'hour' });
    assert.equal(j.jobUrl, 'https://jobviewtrack.com/v2/abc');
    assert.equal(j.sourceJobId?.length, 16);
  });

  it('Jooble records the origin site so Indeed-sourced rows can be rejected', () => {
    const [j] = parseJooble({ totalCount: 1, jobs: [{ id: 42, title: '<b>Medical</b> Biller', location: 'Remote', snippet: 'x', source: 'indeed.com', link: 'https://jooble.org/desc/42', company: 'Acme', updated: '2026-09-28T01:00:00.000' }] }, CTX);
    assert.equal(j.title, 'Medical Biller');
    assert.equal(j.originSite, 'indeed.com');
  });

  it('Job Bank Atom feed entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title type="html"><![CDATA[medical billing clerk]]></title>
      <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50382759"/>
      <id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=3681919</id>
      <updated>2026-09-28T07:37:00Z</updated>
      <summary type="html"><![CDATA[<strong>Job number:</strong> 3681919<br /><strong>Location:</strong> Markham (ON) <br /><strong>Employer:</strong> Spectrum Health Care<br /><strong>Salary:</strong> $22.26 to $23.56 hourly]]></summary>
    </entry></feed>`;
    const [j] = parseJobBankFeed(xml, CTX);
    assert.equal(j.title, 'medical billing clerk');
    assert.equal(j.sourceJobId, '50382759');
    assert.equal(j.location, 'Markham (ON)');
    assert.equal(j.company, 'Spectrum Health Care');
    assert.equal(j.salaryRaw, '$22.26 to $23.56 hourly');
    assert.equal(j.countryHint, 'CA');
  });

  it('SimplyHired __NEXT_DATA__ and Indeed Apply flag', () => {
    const data = { props: { pageProps: { resultCount: 1, pageCursors: { '2': 'CUR' }, jobs: [{ jobKey: 'K1', title: 'Risk Adjustment Coder', company: 'Medical Coding Coach', location: 'Remote', remoteAttributes: ['Remote'], indeedApply: true, dateOnIndeed: 1790604000000 }] } } };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    const parsed = parseSimplyHiredSearch(html);
    assert.equal(parsed.pageCursors['2'], 'CUR');
    const raw = simplyHiredJobToRaw(parsed.jobs[0], { ...CTX, remoteFiltered: true });
    assert.equal(raw.viaIndeed, true);
    assert.equal(raw.jobUrl, 'https://www.simplyhired.com/job/K1');
  });
});

describe('feed keyword filter', () => {
  it('requires every significant keyword token', () => {
    assert.equal(looseKeywordMatch('medical billing', 'Medical Billing Specialist'), true);
    assert.equal(looseKeywordMatch('medical billing', 'Billing Analyst', ['finance']), false);
    assert.equal(looseKeywordMatch('ehr support specialist', 'Specialist', 'EHR support for clinics'), true);
  });
});
