import type { RunMetrics, SearchSummary, SourceRunReport } from '../models/search.ts';

const fmt = (n: number) => n.toLocaleString('en-US');

export function formatSourceReport(reports: SourceRunReport[]): string {
  const header = ['SOURCE', 'STATUS', 'RAW', 'UNIQUE', 'ACCEPTED', 'REQUESTS', 'TIME', 'NOTE'];
  const rows = reports.map((r) => [
    r.name,
    r.status,
    fmt(r.raw),
    fmt(r.unique),
    fmt(r.accepted),
    fmt(r.requests),
    `${(r.durationMs / 1000).toFixed(1)}s`,
    (r.note ?? r.errors[0]?.message ?? '').slice(0, 90),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const numeric = new Set([2, 3, 4, 5, 6]);
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : numeric.has(i) ? c.padStart(widths[i]) : c.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}

export function formatMetrics(m: RunMetrics, hoursOld: number): string {
  return [
    `Search keywords:              ${fmt(m.search_keywords)}`,
    `Sources requested:            ${fmt(m.sources_requested)}`,
    '',
    `Raw listings:                 ${fmt(m.raw_listings)}`,
    `Unique listings (per source): ${fmt(m.unique_listings)}`,
    `Removed as Indeed-routed:     ${fmt(m.removed_indeed)}`,
    `Removed as invalid:           ${fmt(m.removed_invalid)}`,
    `Removed as low quality:       ${fmt(m.removed_low_quality)}`,
    `Removed as irrelevant:        ${fmt(m.removed_irrelevant)}`,
    `Removed as non-US:            ${fmt(m.removed_non_us)}`,
    `Removed as hybrid/onsite:     ${fmt(m.removed_not_remote)}`,
    `Removed as older than ${hoursOld}h:`.padEnd(30) + fmt(m.removed_too_old),
    `Removed as duplicates:        ${fmt(m.removed_duplicates)}`,
    '',
    `Final unique jobs:            ${fmt(m.final_unique_jobs)}`,
  ].join('\n');
}

export function formatSummaryLine(s: SearchSummary): string {
  return `sources ok=${s.sources_succeeded} failed=${s.sources_failed} skipped=${s.sources_skipped} raw=${s.raw_jobs_found} remote_us=${s.remote_us_jobs} unique=${s.deduplicated_jobs} new=${s.new_jobs} in ${(s.duration_ms / 1000).toFixed(1)}s${s.timed_out ? ' (TIMED OUT - partial results)' : ''}`;
}
