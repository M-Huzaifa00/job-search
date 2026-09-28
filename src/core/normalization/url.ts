import { isIP } from 'node:net';

/** Parses a URL, returning null instead of throwing. */
export function tryParseUrl(url: string | null | undefined, base?: string): URL | null {
  if (!url) return null;
  try {
    return new URL(url.trim(), base);
  } catch {
    return null;
  }
}

export function isHttpUrl(url: string | null | undefined): boolean {
  const u = tryParseUrl(url);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
}

const INDEED_HOST = /(^|\.)indeed(apply|jobs)?\.[a-z]{2,3}(\.[a-z]{2})?$|(^|\.)indeed\.jobs$/i;

function hostIsIndeed(host: string): boolean {
  return INDEED_HOST.test(host);
}

/**
 * True when the URL points at Indeed — directly, or through an encoded redirect target in
 * its query string (e.g. `?url=https%3A%2F%2Fwww.indeed.com%2F...`).
 */
export function isIndeedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = tryParseUrl(url);
  if (!u) return /(^|[/.@])indeed\.(com|[a-z]{2,3})\b/i.test(url);
  if (hostIsIndeed(u.hostname)) return true;
  for (const value of u.searchParams.values()) {
    if (/^https?:|%3A%2F%2F|^\/\//i.test(value)) {
      const decoded = safeDecode(value);
      const inner = tryParseUrl(decoded);
      if (inner && (hostIsIndeed(inner.hostname) || isIndeedUrl(inner.toString()))) return true;
    }
  }
  return false;
}

/** Text mentions like "Apply on Indeed" / "via Indeed" used by aggregators to label origin. */
export function mentionsIndeedOrigin(value: string | null | undefined): boolean {
  return !!value && /\bindeed\b/i.test(value);
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'trk',
  'trkinfo',
  'trackingid',
  'refid',
  'position',
  'pagenum',
  'originalsubdomain',
  'lipi',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'gh_src',
  'lever-source',
  'lever-origin',
  'jobcardtrackingkey',
  'xkcb',
  'ebp',
  'eid',
  'sid',
  'cmpid',
  'campaignid',
  'source_id',
  'iis',
  'iisn',
  'mode_utm',
  'urlhash',
]);

export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_PARAMS.has(n);
}

/** Canonical form used for duplicate detection: https, lowercase host, no tracking params, no fragment. */
export function canonicalizeUrl(url: string): string {
  const u = tryParseUrl(url);
  if (!u) return url.trim();
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  if (u.protocol === 'http:') u.protocol = 'https:';
  u.port = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => !isTrackingParam(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let out = u.toString();
  if (u.pathname.length > 1 && out.endsWith('/') && !u.search) out = out.slice(0, -1);
  return out;
}

/** Removes tracking parameters but otherwise keeps the URL intact (safe for users to click). */
export function stripTracking(url: string): string {
  const u = tryParseUrl(url);
  if (!u) return url;
  for (const k of [...u.searchParams.keys()]) if (isTrackingParam(k)) u.searchParams.delete(k);
  return u.toString();
}

const MULTI_PART_TLDS = new Set(['co.uk', 'com.au', 'co.in', 'com.br', 'co.nz', 'com.mx', 'co.za', 'com.ph', 'com.pk']);

/** Registrable domain (best effort, no PSL dependency): "careers.example.co.uk" -> "example.co.uk". */
export function registrableDomain(url: string | null | undefined): string | null {
  const u = tryParseUrl(url);
  if (!u || !u.hostname || isIP(u.hostname)) return null;
  const parts = u.hostname.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_PART_TLDS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export interface AtsInfo {
  provider: string;
  jobId: string | null;
  company: string | null;
}

interface AtsRule {
  provider: string;
  host: RegExp;
  extract?: (u: URL) => { jobId: string | null; company: string | null };
}

const seg = (u: URL) => u.pathname.split('/').filter(Boolean);

const ATS_RULES: AtsRule[] = [
  {
    provider: 'Greenhouse',
    host: /(^|\.)greenhouse\.io$/i,
    extract: (u) => {
      const s = seg(u);
      const i = s.indexOf('jobs');
      return { jobId: u.searchParams.get('gh_jid') ?? (i >= 0 ? s[i + 1] ?? null : null), company: s[0] && s[0] !== 'embed' ? s[0] : u.searchParams.get('for') };
    },
  },
  { provider: 'Lever', host: /(^|\.)lever\.co$/i, extract: (u) => ({ company: seg(u)[0] ?? null, jobId: seg(u)[1] ?? null }) },
  {
    provider: 'Workday',
    host: /(^|\.)myworkday(jobs|site)\.com$/i,
    extract: (u) => {
      const last = seg(u).at(-1) ?? '';
      const m = last.match(/_((?:JR|R|REQ)?[-_]?\d{3,}[\w-]*)$/i);
      return { company: u.hostname.split('.')[0], jobId: m ? m[1] : last || null };
    },
  },
  { provider: 'Ashby', host: /(^|\.)ashbyhq\.com$/i, extract: (u) => ({ company: seg(u)[0] ?? null, jobId: seg(u)[1] ?? null }) },
  { provider: 'SmartRecruiters', host: /(^|\.)smartrecruiters\.com$/i, extract: (u) => ({ company: seg(u)[0] ?? null, jobId: (seg(u)[1] ?? '').split('-')[0] || null }) },
  {
    provider: 'iCIMS',
    host: /(^|\.)icims\.com$/i,
    extract: (u) => {
      const m = u.pathname.match(/\/jobs\/(\d+)/);
      return { company: u.hostname.split('.')[0].replace(/^(careers|jobs|uscareers)-/, ''), jobId: m ? m[1] : null };
    },
  },
  {
    provider: 'Jobvite',
    host: /(^|\.)jobvite\.com$/i,
    extract: (u) => {
      const s = seg(u);
      const i = s.indexOf('job');
      return { company: s[0] ?? null, jobId: i >= 0 ? s[i + 1] ?? null : u.searchParams.get('j') };
    },
  },
  {
    provider: 'BambooHR',
    host: /(^|\.)bamboohr\.com$/i,
    extract: (u) => ({ company: u.hostname.split('.')[0], jobId: u.pathname.match(/\/(?:careers|jobs)\/(\d+)/)?.[1] ?? u.searchParams.get('id') }),
  },
  {
    provider: 'Oracle Recruiting',
    host: /(^|\.)(oraclecloud\.com|taleo\.net)$/i,
    extract: (u) => ({ company: u.hostname.split('.')[0], jobId: u.pathname.match(/\/job\/(\d+)/)?.[1] ?? u.searchParams.get('job') }),
  },
  {
    provider: 'ADP Recruiting',
    host: /(^|\.)adp\.com$/i,
    extract: (u) => ({ company: u.searchParams.get('cid'), jobId: u.searchParams.get('jobId') ?? u.searchParams.get('jobid') }),
  },
  { provider: 'UKG', host: /(^|\.)(ultipro\.com|ukg\.net)$/i, extract: (u) => ({ company: seg(u)[1] ?? null, jobId: u.searchParams.get('opportunityId') ?? seg(u).at(-1) ?? null }) },
  { provider: 'Paylocity', host: /(^|\.)paylocity\.com$/i, extract: (u) => ({ company: null, jobId: u.pathname.match(/\/Details\/(\d+)/i)?.[1] ?? null }) },
  { provider: 'Paycom', host: /(^|\.)paycomonline\.net$/i, extract: (u) => ({ company: u.searchParams.get('clientkey'), jobId: u.searchParams.get('job') }) },
  { provider: 'Workable', host: /(^|\.)workable\.com$/i, extract: (u) => ({ company: seg(u)[0] ?? null, jobId: seg(u)[2] ?? null }) },
  { provider: 'JazzHR', host: /(^|\.)(applytojob\.com|jazzhr\.com)$/i, extract: (u) => ({ company: u.hostname.split('.')[0], jobId: seg(u)[2] ?? null }) },
  { provider: 'Breezy HR', host: /(^|\.)breezy\.hr$/i, extract: (u) => ({ company: u.hostname.split('.')[0], jobId: seg(u)[1] ?? null }) },
  { provider: 'Rippling', host: /(^|\.)rippling-ats\.com$|ats\.rippling\.com$/i, extract: (u) => ({ company: seg(u)[0] ?? null, jobId: seg(u).at(-1) ?? null }) },
  { provider: 'SuccessFactors', host: /(^|\.)successfactors\.(com|eu)$/i },
  { provider: 'Dayforce', host: /(^|\.)dayforcehcm\.com$/i, extract: (u) => ({ company: seg(u)[1] ?? null, jobId: seg(u).at(-1) ?? null }) },
  { provider: 'Recruitee', host: /(^|\.)recruitee\.com$/i, extract: (u) => ({ company: u.hostname.split('.')[0], jobId: seg(u)[1] ?? null }) },
];

export function detectAts(url: string | null | undefined): AtsInfo | null {
  const u = tryParseUrl(url);
  if (!u) return null;
  for (const rule of ATS_RULES) {
    if (rule.host.test(u.hostname)) {
      const ex = rule.extract?.(u) ?? { jobId: null, company: null };
      return { provider: rule.provider, jobId: ex.jobId ?? null, company: ex.company?.toLowerCase() ?? null };
    }
  }
  return null;
}

const JOB_BOARD_HOSTS = /(^|\.)(linkedin\.com|dice\.com|remoteok\.com|remotive\.com|jobicy\.com|jooble\.org|careerjet\.[a-z.]+|jobviewtrack\.com|jobbank\.gc\.ca|simplyhired\.com|ziprecruiter\.com|glassdoor\.[a-z.]+|monster\.com|careerbuilder\.com|builtin\.com|wellfound\.com|jobright\.ai|flexjobs\.com|talent\.com|lensa\.com|jobgether\.com|adzuna\.[a-z.]+)$/i;

export function isJobBoardUrl(url: string | null | undefined): boolean {
  const u = tryParseUrl(url);
  return !!u && JOB_BOARD_HOSTS.test(u.hostname);
}

/** Aggregator click-trackers whose destination must be resolved before we can trust it. */
export function isRedirectTracker(url: string | null | undefined): boolean {
  const u = tryParseUrl(url);
  if (!u) return false;
  return /(^|\.)(jobviewtrack\.com|jooble\.org)$/i.test(u.hostname) || /\/(away|redirect|out|clk|click|rc\/clk)\b/i.test(u.pathname);
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * SSRF guard for URLs we follow (only URLs that came from job sources, never user input):
 * http(s) only, default ports, no localhost / private / link-local address literals.
 */
export function isPublicHttpUrl(url: string | null | undefined): boolean {
  const u = tryParseUrl(url);
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return !isPrivateIPv4(host);
  if (ipVersion === 6) return !(host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host === '::' || host.startsWith('::ffff:'));
  return host.includes('.');
}
