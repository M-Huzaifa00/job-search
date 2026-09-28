import { normalizeForMatch } from '../../utils/text.ts';

const STOP = new Set(['and', 'or', 'the', 'of', 'for', 'in', 'a', 'an', 'to', 'with']);

/**
 * Loose local filter for feed-style sources (one request returns every job): keeps listings whose
 * title/tags/description contain every significant token of the keyword. The strict contextual
 * relevance check happens later in the pipeline.
 */
export function looseKeywordMatch(keyword: string, ...fields: (string | null | undefined | string[])[]): boolean {
  const tokens = normalizeForMatch(keyword)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
  if (tokens.length === 0) return true;
  const hay = normalizeForMatch(fields.flat().filter(Boolean).join(' ')).slice(0, 20_000);
  return tokens.every((t) => new RegExp(`\\b${t}`).test(hay));
}
