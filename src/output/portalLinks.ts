import type { SourceId } from '../models/job.ts';
import { allAdapters } from '../sources/registry.ts';
import type { ManualSearchQuery, SourceAdapter } from '../sources/types.ts';
import { csvCell } from './csv.ts';

export interface PortalLinkSet {
  portals: { id: SourceId; name: string; status: string; filters: string[] }[];
  rows: { title: string; urls: Partial<Record<SourceId, string>> }[];
  hoursOld: number;
  remoteOnly: boolean;
}

/** Search links for every portal that can't be scraped (blocked or off by policy), one per title. */
export function buildPortalLinks(titles: string[], q: Omit<ManualSearchQuery, 'keyword'>, adapters: SourceAdapter[] = allAdapters()): PortalLinkSet {
  const withLinks = adapters.filter((a) => a.manualSearch);
  const portals = withLinks.map((a) => ({
    id: a.meta.id,
    name: a.meta.name,
    status: a.meta.status,
    // Filters depend only on hoursOld/remoteOnly, so any title shows them.
    filters: a.manualSearch!({ ...q, keyword: titles[0] ?? '' }).filters,
  }));
  const rows = titles.map((title) => ({
    title,
    urls: Object.fromEntries(withLinks.map((a) => [a.meta.id, a.manualSearch!({ ...q, keyword: title }).url])) as Partial<Record<SourceId, string>>,
  }));
  return { portals, rows, ...q };
}

export function portalLinksToCsv(set: PortalLinkSet, opts: { bom?: boolean } = {}): string {
  const lines = ['portal,title,filters,url'];
  for (const row of set.rows) {
    for (const p of set.portals) {
      const url = row.urls[p.id];
      if (url) lines.push([p.name, row.title, p.filters.join(' · '), url].map(csvCell).join(','));
    }
  }
  return (opts.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function portalLinksToHtml(set: PortalLinkSet, generatedAt = new Date()): string {
  const span = set.hoursOld <= 24 ? 'the last 24 hours' : `the last ${set.hoursOld} hours`;
  const head = set.portals
    .map((p) => `<th scope="col">${esc(p.name)}<span class="f">${esc(p.filters.join(' · ') || 'set filters on the site')}</span></th>`)
    .join('');
  const body = set.rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.title)}</th>${set.portals
          .map((p) => {
            const url = r.urls[p.id];
            return url ? `<td><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a></td>` : '<td></td>';
          })
          .join('')}</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portal Search Links</title>
<style>
  :root { --bg: #fbfbfa; --fg: #1f2328; --muted: #656d76; --line: #d8dee4; --link: #0b62d6; --head: #f1f3f5; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181b; --fg: #e6e8eb; --muted: #9aa3ad; --line: #30363d; --link: #6cb0ff; --head: #1e2227; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { margin: 0 0 16px; color: var(--muted); max-width: 72ch; }
  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
  thead th { background: var(--head); position: sticky; top: 0; vertical-align: bottom; }
  tbody th { font-weight: 500; }
  .f { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
  a { color: var(--link); }
  tbody tr:last-child > * { border-bottom: 0; }
</style>
</head>
<body>
<main>
<h1>Portal search links</h1>
<p>These portals block automated access, so the scraper can't collect their jobs. Each link opens a search in your own browser${set.remoteOnly ? ', filtered to remote jobs' : ''}, aiming at jobs posted in ${esc(span)}. The small text under each portal lists the filters the link sets; set anything else on the site. Generated ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>
<div class="wrap"><table>
<thead><tr><th scope="col">Title</th>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>
</main>
</body>
</html>
`;
}
