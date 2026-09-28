import type { SalaryInfo, SalaryPeriod } from '../../models/job.ts';

const PERIOD_PATTERNS: [RegExp, SalaryPeriod][] = [
  [/\b(per|an?|\/|each)\s*(hour|hr)\b|\bhourly\b|\/\s*h(ou)?r\b|\bph\b/i, 'hour'],
  [/\b(per|an?|\/)\s*(day)\b|\bdaily\b/i, 'day'],
  [/\b(per|an?|\/)\s*(week|wk)\b|\bweekly\b/i, 'week'],
  [/\b(per|an?|\/)\s*(month|mo)\b|\bmonthly\b/i, 'month'],
  [/\b(per|an?|\/)\s*(year|yr|annum)\b|\b(annual(ly)?|yearly|salary)\b|\bp\.?a\.?\b/i, 'year'],
];

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/\bCAD\b|C\$|CA\$/i, 'CAD'],
  [/\bAUD\b|A\$|AU\$/i, 'AUD'],
  [/£|\bGBP\b/i, 'GBP'],
  [/€|\bEUR\b/i, 'EUR'],
  [/₹|\bINR\b/i, 'INR'],
  [/\bUSD\b|US\$|\$/i, 'USD'],
];

export function periodFromCode(code: string | null | undefined): SalaryPeriod | null {
  if (!code) return null;
  const c = code.trim().toLowerCase();
  if (['h', 'hour', 'hourly', 'per_hour'].includes(c)) return 'hour';
  if (['d', 'day', 'daily'].includes(c)) return 'day';
  if (['w', 'week', 'weekly'].includes(c)) return 'week';
  if (['m', 'month', 'monthly'].includes(c)) return 'month';
  if (['y', 'a', 'year', 'yearly', 'annual', 'annually', 'annum'].includes(c)) return 'year';
  return null;
}

/** Guess a period from magnitude only when the text gives none. Returns null when ambiguous. */
function inferPeriod(value: number): SalaryPeriod | null {
  if (value >= 10 && value <= 250) return 'hour';
  if (value >= 15_000 && value <= 1_000_000) return 'year';
  return null;
}

/**
 * Parses salary text into normalized numbers. Never invents values:
 * returns nulls when the text does not contain a recognisable amount.
 *
 *   "$25/hour"            -> 25 / 25 / USD / hour
 *   "$50k-$65k"           -> 50000 / 65000 / USD / year
 *   "$4,500/month"        -> 4500 / 4500 / USD / month
 *   "USD 140,000.00 - 170,000.00 per year"
 */
export function parseSalary(raw: string | null | undefined): SalaryInfo | null {
  if (!raw) return null;
  const text = raw.replace(/ /g, ' ').trim();
  if (!text || !/\d/.test(text)) return null;

  const amounts: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|K|thousand|m|M)?(?![\d%])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && amounts.length < 2) {
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    // Skip numbers that are clearly not money, e.g. "401(k)" or "2 days".
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8).toLowerCase();
    if (/^\s*(\(k\)|days?|years?\s+(of\s+)?exp|%|\+\s*years)/.test(after) && !/[$£€]/.test(before)) continue;
    let n = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
    const suffix = m[3]?.toLowerCase();
    if (suffix === 'k' || suffix === 'thousand') n *= 1_000;
    if (suffix === 'm') n *= 1_000_000;
    if (Number.isFinite(n) && n > 0) amounts.push(n);
  }
  if (amounts.length === 0) return null;

  // "$50-65k": apply the thousands suffix to the lower bound too.
  if (amounts.length === 2 && /\d\s*(k|K)\b/.test(text) && amounts[0] < 1_000 && amounts[1] >= 1_000) amounts[0] *= 1_000;

  let period: SalaryPeriod | null = null;
  for (const [pat, p] of PERIOD_PATTERNS) {
    if (pat.test(text)) {
      period = p;
      break;
    }
  }
  let currency: string | null = null;
  for (const [pat, c] of CURRENCY_PATTERNS) {
    if (pat.test(text)) {
      currency = c;
      break;
    }
  }

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (!period) period = inferPeriod(max);
  const isUpTo = /\b(up to|max(imum)?)\b/i.test(text) && amounts.length === 1;
  const isFrom = /\b(from|starting at|min(imum)?|at least)\b/i.test(text) && amounts.length === 1;
  return {
    min: isUpTo ? null : round2(min),
    max: isFrom ? null : round2(max),
    currency,
    period,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Formats structured salary data (from JSON APIs) as display text when the source has no text. */
export function formatSalary(s: SalaryInfo | null | undefined): string | null {
  if (!s || (s.min === null && s.max === null)) return null;
  const cur = s.currency === 'USD' || !s.currency ? '$' : `${s.currency} `;
  const fmt = (n: number) => cur + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const range = s.min !== null && s.max !== null && s.min !== s.max ? `${fmt(s.min)} - ${fmt(s.max)}` : fmt((s.min ?? s.max)!);
  return s.period ? `${range} per ${s.period}` : range;
}
