import type { RawJob } from '../../models/job.ts';
import { collapseWhitespace, loadHtml } from '../../utils/text.ts';

export interface DiceCard {
  guid: string;
  title: string;
  company: string | null;
  location: string | null;
  postedText: string | null;
  employmentType: string | null;
  salary: string | null;
  url: string;
}

/** Parses the server-rendered job cards on https://www.dice.com/jobs. */
export function parseDiceSearch(html: string): DiceCard[] {
  const $ = loadHtml(html);
  const cards: DiceCard[] = [];
  const seen = new Set<string>();
  $('[data-testid="job-card"]').each((_, el) => {
    const card = $(el);
    const link = card.find('[data-testid="job-search-job-detail-link"]').first();
    const href = link.attr('href') ?? card.find('a[href*="/job-detail/"]').first().attr('href') ?? '';
    const guid = card.attr('data-job-guid') ?? href.match(/\/job-detail\/([\w-]+)/)?.[1];
    if (!guid || seen.has(guid)) return;
    const title = collapseWhitespace(link.text()) || collapseWhitespace(link.attr('aria-label') ?? '');
    if (!title) return;
    seen.add(guid);

    // "Remote • Today" / "Austin, Texas • 3 days ago"
    let location: string | null = null;
    let postedText: string | null = null;
    card.find('p').each((_, p) => {
      const t = collapseWhitespace($(p).text());
      if (!location && t.includes('•')) {
        const [loc, posted] = t.split('•').map((s) => s.trim());
        location = loc || null;
        postedText = posted || null;
      }
    });
    cards.push({
      guid,
      title,
      company: collapseWhitespace(card.find('[data-testid="job-card-company-name"]').first().text()) || null,
      location,
      postedText,
      employmentType: collapseWhitespace(card.find('[id="employmentType-label"]').first().text()) || null,
      salary: collapseWhitespace(card.find('[id="salary-label"]').first().text()) || null,
      url: `https://www.dice.com/job-detail/${guid}`,
    });
  });
  return cards;
}

export function diceCardToRaw(card: DiceCard, ctx: { fetchedAt: string; keyword: string; sourceUrl: string; remoteFiltered: boolean }): RawJob {
  return {
    source: 'dice',
    sourceJobId: card.guid,
    title: card.title,
    company: card.company,
    location: card.location,
    employmentType: card.employmentType,
    salaryRaw: card.salary,
    postedText: card.postedText,
    fetchedAt: ctx.fetchedAt,
    jobUrl: card.url,
    applyUrl: null,
    sourceUrl: ctx.sourceUrl,
    remoteHints: ctx.remoteFiltered ? [{ kind: 'source_remote_filter', detail: 'Dice workplace type = Remote' }] : [],
    countryHint: null,
    foundBy: [ctx.keyword],
  };
}
