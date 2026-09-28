import type { DateConfidence } from '../../models/job.ts';

export interface ParsedDate {
  postedAt: string | null;
  confidence: DateConfidence;
}

const HOUR = 3_600_000;
const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: HOUR,
  day: 24 * HOUR,
  week: 7 * 24 * HOUR,
  month: 30 * 24 * HOUR,
  year: 365 * 24 * HOUR,
};

function unitKey(u: string): string | null {
  const s = u.toLowerCase();
  if (/^(s|sec|secs|second|seconds)$/.test(s)) return 'second';
  if (/^(m|min|mins|minute|minutes)$/.test(s)) return 'minute';
  if (/^(h|hr|hrs|hour|hours)$/.test(s)) return 'hour';
  if (/^(d|day|days)$/.test(s)) return 'day';
  if (/^(w|wk|wks|week|weeks)$/.test(s)) return 'week';
  if (/^(mo|mos|month|months)$/.test(s)) return 'month';
  if (/^(y|yr|yrs|year|years)$/.test(s)) return 'year';
  return null;
}

/**
 * Converts relative posting text into an absolute timestamp, relative to when the page was fetched.
 * "today" is estimated conservatively (12h ago); "1 day ago" maps to exactly 24h so it is kept only
 * for a 24h window's boundary; "30+ days ago" is treated as at least 30 days.
 */
export function parseRelativeDate(text: string, reference: Date): ParsedDate | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^(posted|reposted|active|updated)\s*:?\s*/, '');
  const ref = reference.getTime();
  const at = (ms: number, confidence: DateConfidence = 'estimated'): ParsedDate => ({ postedAt: new Date(ref - ms).toISOString(), confidence });

  if (/^(just now|just posted|moments? ago|few seconds ago|now|new)$/.test(t)) return at(0);
  if (/^today$|^posted today$/.test(t)) return at(12 * HOUR);
  if (/^yesterday$/.test(t)) return at(36 * HOUR);
  if (/^(an?|one) (hour|hr)s? ago$/.test(t)) return at(HOUR);
  if (/^(an?|one) (minute|min)s? ago$/.test(t)) return at(60_000);
  if (/^(an?|one) day ago$/.test(t)) return at(24 * HOUR);
  if (/^(an?|one) week ago$/.test(t)) return at(7 * 24 * HOUR);
  if (/^(an?|one) month ago$/.test(t)) return at(30 * 24 * HOUR);

  const m = t.match(/^(\d+)\s*\+?\s*([a-z]+)\.?\s*(ago)?$/);
  if (m) {
    const key = unitKey(m[2]);
    if (!key) return null;
    const n = Number(m[1]);
    // Minute/hour granularity is precise enough to call "exact" for filtering purposes.
    const confidence: DateConfidence = key === 'second' || key === 'minute' || key === 'hour' ? 'exact' : 'estimated';
    return at(n * UNIT_MS[key], confidence);
  }
  return null;
}

/** Parses an absolute value: ISO 8601, RFC 2822, epoch seconds/ms, or YYYY-MM-DD. */
export function parseAbsoluteDate(value: string | number, reference: Date): ParsedDate | null {
  let ms: number;
  let confidence: DateConfidence = 'exact';
  if (typeof value === 'number' || /^\d{9,13}$/.test(String(value).trim())) {
    const n = Number(value);
    ms = n < 1e12 ? n * 1_000 : n;
  } else {
    const s = String(value).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      // Date only: assume noon UTC of that day and mark as an estimate.
      ms = Date.parse(`${s}T12:00:00Z`);
      confidence = 'estimated';
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
      // No zone designator (e.g. Remotive): treat as UTC.
      ms = Date.parse(s + 'Z');
    } else {
      ms = Date.parse(s);
    }
  }
  if (!Number.isFinite(ms)) return null;
  // Clamp small future skews to the reference time; reject absurd values.
  const refMs = reference.getTime();
  if (ms > refMs + 48 * HOUR || ms < Date.parse('2000-01-01')) return null;
  return { postedAt: new Date(Math.min(ms, refMs)).toISOString(), confidence };
}

/**
 * Combines an absolute date and relative text, preferring whichever is more precise.
 * A date-only absolute value ("2026-09-28") loses to relative text ("16 minutes ago").
 */
export function resolvePostedDate(input: { postedAt?: string | number | null; postedText?: string | null }, fetchedAt: string | Date): ParsedDate {
  const ref = typeof fetchedAt === 'string' ? new Date(fetchedAt) : fetchedAt;
  const abs = input.postedAt !== undefined && input.postedAt !== null && input.postedAt !== '' ? parseAbsoluteDate(input.postedAt, ref) : null;
  const rel = input.postedText ? parseRelativeDate(input.postedText, ref) : null;
  if (abs?.confidence === 'exact') return abs;
  if (rel && (rel.confidence === 'exact' || !abs)) return rel;
  if (abs) return abs;
  if (rel) return rel;
  if (input.postedText) {
    const fromText = parseAbsoluteDate(input.postedText, ref);
    if (fromText) return fromText;
  }
  return { postedAt: null, confidence: 'unknown' };
}

export function ageHours(postedAt: string | null, now: Date = new Date()): number | null {
  if (!postedAt) return null;
  const ms = now.getTime() - Date.parse(postedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((ms / HOUR) * 10) / 10);
}
