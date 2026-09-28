import type { NormalizedJob } from '../models/job.ts';

/** Column order for CSV output (the required columns first, then useful extras). */
export const CSV_COLUMNS: (keyof NormalizedJob)[] = [
  'source',
  'sources',
  'title',
  'company',
  'location',
  'remote_type',
  'remote_scope',
  'employment_type',
  'salary_raw',
  'salary_min',
  'salary_max',
  'salary_currency',
  'salary_period',
  'matched_keyword',
  'matched_keywords',
  'posted_at',
  'age_hours',
  'date_confidence',
  'description',
  'job_url',
  'apply_url',
  'ats_provider',
  'listing_type',
  'canonical_url',
  'source_url',
  'company_domain',
  'keyword_category',
  'keyword_confidence',
  'medical_role_score',
  'remote_confidence',
  'quality_flags',
  'first_seen_at',
  'is_new',
  'reposted_at',
  'duplicate_count',
  'is_duplicate',
  'duplicate_of',
  'id',
];

/** Excel caps a cell at 32,767 characters. */
const MAX_CELL = 32_000;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (s.length > MAX_CELL) s = s.slice(0, MAX_CELL - 1) + '…';
  // Neutralise spreadsheet formula injection (=, +, @, tab/CR prefixes).
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function jobsToCsv(jobs: NormalizedJob[], opts: { bom?: boolean } = {}): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const job of jobs) {
    lines.push(
      CSV_COLUMNS.map((col) => {
        // The CSV carries plain-text descriptions; HTML stays in JSON output.
        if (col === 'description') return csvCell(job.description_text ?? job.description);
        return csvCell(job[col]);
      }).join(','),
    );
  }
  return (opts.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
