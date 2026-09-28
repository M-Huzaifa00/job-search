import type { RawJob } from '../../models/job.ts';

export interface RemoteOkItem {
  id?: string | number;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  apply_url?: string;
  url?: string;
  salary_min?: number;
  salary_max?: number;
}

function fixHost(url: string | undefined): string | undefined {
  return url?.replace(/^https?:\/\/remoteok\.com/i, 'https://remoteok.com');
}

/** Maps the RemoteOK API array (first element is the legal notice). */
export function parseRemoteOk(items: RemoteOkItem[], ctx: { fetchedAt: string; keyword: string; sourceUrl: string }): RawJob[] {
  const out: RawJob[] = [];
  for (const it of items) {
    if (!it || !it.id || !it.position) continue;
    const jobUrl = fixHost(it.url) ?? `https://remoteok.com/remote-jobs/${it.slug ?? it.id}`;
    const applyUrl = fixHost(it.apply_url);
    const hasSalary = (it.salary_min ?? 0) > 0 || (it.salary_max ?? 0) > 0;
    const location = it.location?.trim() || null;
    out.push({
      source: 'remoteok',
      sourceJobId: String(it.id),
      title: it.position.trim(),
      company: it.company?.trim() || null,
      location,
      descriptionHtml: it.description ?? null,
      postedAt: it.epoch ?? it.date ?? null,
      fetchedAt: ctx.fetchedAt,
      jobUrl,
      applyUrl: applyUrl && applyUrl !== jobUrl ? applyUrl : null,
      sourceUrl: ctx.sourceUrl,
      tags: it.tags ?? [],
      salary: hasSalary ? { min: it.salary_min || null, max: it.salary_max || null, currency: 'USD', period: 'year' } : null,
      remoteHints: [{ kind: 'remote_only_board', detail: 'RemoteOK lists remote jobs only' }],
      applicantLocations: location ? [location] : [],
      countryHint: null,
      foundBy: [ctx.keyword],
    });
  }
  return out;
}
