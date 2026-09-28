import { normalizeForMatch } from '../../utils/text.ts';

const LEGAL_SUFFIXES =
  /\b(incorporated|inc|llc|l\s?l\s?c|ltd|limited|corp|corporation|co|company|plc|lp|llp|pllc|pc|p\s?c|pa|p\s?a|gmbh|sa|ag|bv|nv|holdings?)\b\.?/g;

/**
 * Canonical employer name for duplicate detection:
 * "ABC Healthcare, Inc." / "ABC Healthcare" / "ABC Health Care Inc" -> "abc healthcare".
 */
export function normalizeCompany(name: string | null | undefined): string {
  if (!name) return '';
  let c = normalizeForMatch(name);
  c = c.replace(/\((formerly|fka|f\/k\/a|a\s+subsidiary|part\s+of)[^)]*\)/g, ' ');
  c = c.replace(/\b(d\/?b\/?a|doing business as)\b.*$/, ' ');
  c = c.replace(/&/g, ' and ');
  c = c.replace(/\bhealth\s+care\b/g, 'healthcare');
  c = c.replace(/[^a-z0-9 ]+/g, ' ');
  c = c.replace(LEGAL_SUFFIXES, ' ');
  c = c.replace(/^the\s+/, '');
  return c.replace(/\s+/g, ' ').trim();
}

const PLACEHOLDER_COMPANIES = /^(confidential|confidential company|undisclosed|company confidential|n\/?a|none|unknown|private|anonymous|hiring company|employer)$/i;

export function isPlaceholderCompany(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim();
  return n.length < 2 || PLACEHOLDER_COMPANIES.test(n);
}
