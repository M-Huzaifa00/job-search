import type { RawJob } from '../../models/job.ts';
import { collapseWhitespace, decodeEntities, loadXml } from '../../utils/text.ts';

/** Drops the flag emoji WWR puts in front of country names ("🇺🇸 United States of America"). */
function cleanCountry(value: string): string {
  return collapseWhitespace(value.replace(/[^\p{L}\p{N}\s,.'()&-]/gu, ''));
}

/** Parses a We Work Remotely RSS feed. Item titles are "Company: Job title". */
export function parseWeWorkRemotely(xml: string, ctx: { fetchedAt: string; keyword: string; sourceUrl: string }): RawJob[] {
  const $ = loadXml(xml);
  const jobs: RawJob[] = [];
  $('item').each((_, el) => {
    const e = $(el);
    const rawTitle = collapseWhitespace(decodeEntities(e.children('title').text()));
    const link = (e.children('link').text() || e.children('guid').text()).trim();
    if (!rawTitle || !link) return;
    const split = rawTitle.match(/^(.+?)\s*:\s+(.+)$/);
    const region = collapseWhitespace(e.children('region').text());
    const country = cleanCountry(e.children('country').text());
    const state = collapseWhitespace(e.children('state').text());
    const skills = collapseWhitespace(e.children('skills').text());
    const category = collapseWhitespace(e.children('category').text());
    jobs.push({
      source: 'weworkremotely',
      sourceJobId: link.replace(/^https?:\/\/[^/]+\/remote-jobs\//, '') || link,
      title: split ? split[2] : rawTitle,
      company: split ? split[1] : null,
      location: [state, country].filter(Boolean).join(', ') || null,
      descriptionHtml: e.children('description').text() || null,
      employmentType: collapseWhitespace(e.children('type').text()) || null,
      postedAt: e.children('pubDate').text().trim() || null,
      fetchedAt: ctx.fetchedAt,
      jobUrl: link,
      applyUrl: null,
      sourceUrl: ctx.sourceUrl,
      tags: [category, ...skills.split(',').map((s) => s.trim())].filter(Boolean),
      remoteHints: [{ kind: 'remote_only_board', detail: 'We Work Remotely lists remote jobs only' }],
      applicantLocations: region ? [region] : [],
      countryHint: null,
      foundBy: [ctx.keyword],
    });
  });
  return jobs;
}
