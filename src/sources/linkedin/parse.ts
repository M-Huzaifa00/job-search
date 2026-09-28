import type { RawJob } from '../../models/job.ts';
import { collapseWhitespace, loadHtml } from '../../utils/text.ts';

export interface LinkedInCard {
  id: string;
  title: string;
  company: string | null;
  companyUrl: string | null;
  location: string | null;
  postedDate: string | null;
  postedText: string | null;
  salary: string | null;
  url: string;
}

/** Parses the job cards returned by /jobs-guest/jobs/api/seeMoreJobPostings/search. */
export function parseLinkedInSearch(html: string): LinkedInCard[] {
  const $ = loadHtml(html);
  const cards: LinkedInCard[] = [];
  const seen = new Set<string>();
  $('.base-search-card, .job-search-card, [data-entity-urn*="jobPosting"]').each((_, el) => {
    const card = $(el);
    const urn = card.attr('data-entity-urn') ?? card.find('[data-entity-urn]').first().attr('data-entity-urn') ?? '';
    const href = card.find('a.base-card__full-link').attr('href') ?? card.attr('href') ?? card.find('a').first().attr('href') ?? '';
    const id = urn.match(/jobPosting:(\d+)/)?.[1] ?? href.match(/-(\d{6,})(?:\?|$)/)?.[1] ?? href.match(/\/view\/(\d+)/)?.[1];
    if (!id || seen.has(id)) return;
    const title = collapseWhitespace(card.find('.base-search-card__title').first().text());
    if (!title) return;
    seen.add(id);
    const subtitle = card.find('.base-search-card__subtitle').first();
    const time = card.find('time').first();
    cards.push({
      id,
      title,
      company: collapseWhitespace(subtitle.text()) || null,
      companyUrl: subtitle.find('a').attr('href')?.split('?')[0] ?? null,
      location: collapseWhitespace(card.find('.job-search-card__location').first().text()) || null,
      postedDate: time.attr('datetime') ?? null,
      postedText: collapseWhitespace(time.text()) || null,
      salary: collapseWhitespace(card.find('.job-search-card__salary-info').first().text()) || null,
      url: `https://www.linkedin.com/jobs/view/${id}`,
    });
  });
  return cards;
}

export interface LinkedInDetail {
  title: string | null;
  company: string | null;
  location: string | null;
  postedText: string | null;
  descriptionHtml: string | null;
  employmentType: string | null;
  seniority: string | null;
  industries: string | null;
  jobFunction: string | null;
  salary: string | null;
  applyUrl: string | null;
  workplace: string | null;
}

/** Parses /jobs-guest/jobs/api/jobPosting/{id}. */
export function parseLinkedInDetail(html: string): LinkedInDetail {
  const $ = loadHtml(html);
  const criteria: Record<string, string> = {};
  $('.description__job-criteria-item').each((_, el) => {
    const k = collapseWhitespace($(el).find('.description__job-criteria-subheader').text()).toLowerCase();
    const v = collapseWhitespace($(el).find('.description__job-criteria-text').text());
    if (k) criteria[k] = v;
  });

  // Off-site applications embed the employer URL in <code id="applyUrl"><!--"https://...?url=<encoded>"--></code>.
  let applyUrl: string | null = null;
  const codeHtml = $('code#applyUrl').html() ?? '';
  const raw = codeHtml.match(/"(https?:[^"]+)"/)?.[1];
  if (raw) {
    try {
      const u = new URL(raw.replace(/&amp;/g, '&'));
      applyUrl = u.searchParams.get('url') ?? raw;
    } catch {
      applyUrl = raw;
    }
  }

  const flavor = $('.topcard__flavor--bullet').first();
  const workplace = collapseWhitespace($('.topcard__flavor--metadata').filter((_, el) => /remote|hybrid|on-?site/i.test($(el).text())).first().text()) || null;
  return {
    title: collapseWhitespace($('.top-card-layout__title, .topcard__title').first().text()) || null,
    company: collapseWhitespace($('.topcard__org-name-link, .topcard__flavor a').first().text()) || null,
    location: collapseWhitespace(flavor.text()) || null,
    postedText: collapseWhitespace($('.posted-time-ago__text').first().text()) || null,
    descriptionHtml: $('.show-more-less-html__markup').first().html()?.trim() || $('.description__text').first().html()?.trim() || null,
    employmentType: criteria['employment type'] ?? null,
    seniority: criteria['seniority level'] ?? null,
    industries: criteria['industries'] ?? null,
    jobFunction: criteria['job function'] ?? null,
    salary: collapseWhitespace($('.salary.compensation__salary, .compensation__salary').first().text()) || null,
    applyUrl,
    workplace,
  };
}

export function cardToRaw(card: LinkedInCard, ctx: { fetchedAt: string; keyword: string; sourceUrl: string; remoteFiltered: boolean }): RawJob {
  return {
    source: 'linkedin',
    sourceJobId: card.id,
    title: card.title,
    company: card.company,
    companyUrl: card.companyUrl,
    location: card.location,
    salaryRaw: card.salary,
    postedAt: card.postedDate,
    postedText: card.postedText,
    fetchedAt: ctx.fetchedAt,
    jobUrl: card.url,
    applyUrl: null,
    sourceUrl: ctx.sourceUrl,
    remoteHints: ctx.remoteFiltered ? [{ kind: 'source_remote_filter', detail: 'LinkedIn workplace type = Remote (f_WT=2)' }] : [],
    countryHint: 'US',
    foundBy: [ctx.keyword],
  };
}
