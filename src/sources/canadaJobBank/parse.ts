import type { RawJob } from '../../models/job.ts';
import { collapseWhitespace, decodeEntities, htmlToText, loadXml } from '../../utils/text.ts';

function field(summary: string, label: string): string | null {
  const m = summary.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
  return m ? collapseWhitespace(m[1]) : null;
}

/** Parses the Job Bank search Atom feed (/jobsearch/feed/jobSearchRSSfeed). */
export function parseJobBankFeed(xml: string, ctx: { fetchedAt: string; keyword: string; sourceUrl: string }): RawJob[] {
  const $ = loadXml(xml);
  const jobs: RawJob[] = [];
  $('entry').each((_, el) => {
    const e = $(el);
    const title = collapseWhitespace(decodeEntities(e.children('title').text()));
    const link = e.children('link').attr('href') ?? '';
    if (!title || !link) return;
    const summaryHtml = e.children('summary').text();
    const summary = htmlToText(summaryHtml.replace(/<br\s*\/?>/gi, '\n'));
    const jobNumber = field(summary, 'Job number') ?? e.children('id').text().match(/id=(\d+)/)?.[1] ?? null;
    jobs.push({
      source: 'canada_job_bank',
      sourceJobId: link.match(/jobposting\/(\d+)/)?.[1] ?? jobNumber,
      title,
      company: field(summary, 'Employer'),
      location: field(summary, 'Location'),
      descriptionText: summary,
      descriptionIsSnippet: true,
      salaryRaw: field(summary, 'Salary'),
      postedAt: e.children('updated').text() || null,
      fetchedAt: ctx.fetchedAt,
      jobUrl: link.split(';')[0],
      applyUrl: null,
      sourceUrl: ctx.sourceUrl,
      remoteHints: [],
      countryHint: 'CA',
      foundBy: [ctx.keyword],
    });
  });
  return jobs;
}
