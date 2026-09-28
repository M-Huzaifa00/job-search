import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

export function collapseWhitespace(s: string): string {
  return s.replace(/[\s ​]+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

const BLOCK_TAGS = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote)\b[^>]*>/gi;

/** Converts job-description HTML into readable plain text (keeps paragraph/list breaks). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Some feeds double-encode HTML.
  if (!/<[a-z]/i.test(s) && /&lt;[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<li\b[^>]*>/gi, '\n• ');
  s = s.replace(BLOCK_TAGS, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

export function sha1(input: string, length = 16): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Lowercase, accent-free, punctuation-light form used by matchers. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word-shingle Jaccard similarity; cheap near-duplicate detection for descriptions. */
export function shingleSimilarity(a: string, b: string, size = 3): number {
  const sa = shingles(a, size);
  const sb = shingles(b, size);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function shingles(text: string, size: number): Set<string> {
  const words = normalizeForMatch(text)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 600);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

export function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeForMatch(s)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function loadHtml(html: string) {
  return cheerio.load(html);
}

export function loadXml(xml: string) {
  return cheerio.load(xml, { xml: true });
}
