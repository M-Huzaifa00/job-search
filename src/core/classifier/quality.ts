import { normalizeForMatch } from '../../utils/text.ts';
import { isPlaceholderCompany } from '../normalization/company.ts';
import { isHttpUrl, isJobBoardUrl, registrableDomain } from '../normalization/url.ts';

export interface QualityInput {
  title: string;
  company: string | null;
  description: string | null;
  descriptionIsSnippet: boolean;
  jobUrl: string;
  applyUrl: string | null;
  atsProvider: string | null;
}

export interface QualityResult {
  flags: string[];
  /** Flags severe enough to drop the listing. */
  hardFlags: string[];
  applyDomainMatchesCompany: boolean;
}

const SCAM_PATTERNS: [RegExp, string][] = [
  [/\b(earn|make)\s+(up\s+to\s+)?\$\s?\d[\d,]*\+?\s*(per|a|\/|every)\s*(day|week)\b/, 'earnings_claim'],
  [/\b(be\s+your\s+own\s+boss|unlimited\s+(earning|income)\s+potential|no\s+experience\s+(needed|required)[^.]{0,60}\b(earn|income|\$))/, 'mlm_language'],
  [/\b(wire\s+transfer|cashier'?s?\s+check|deposit\s+(a|the)\s+check|purchase\s+(your\s+own\s+)?equipment\s+(with|using)\s+(a|the)\s+check)\b/, 'check_scam'],
  [/\b(contact|text|message)\s+(us|me|the\s+(hiring\s+)?manager)?\s*(on|via)\s+(telegram|whatsapp|signal|google\s+hangouts?)\b/, 'messaging_app_contact'],
  [/\b(pay|payment|fee)\s+(for|of)\s+(training|certification|starter\s+kit|background\s+check)\s+(is\s+)?required\b/, 'upfront_fee'],
];

const GENERIC_TITLES = /^(work\s+from\s+home|remote\s+(job|work|position)s?|data\s+entry|online\s+jobs?|home\s+based\s+(job|work)|hiring\s+now|immediate\s+hire|jobs?)$/i;

function companyTokens(company: string): string[] {
  return normalizeForMatch(company)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !['health', 'healthcare', 'medical', 'group', 'services', 'solutions', 'systems', 'center', 'care', 'company'].includes(t));
}

/** Authenticity checks. Legitimate staffing listings are not penalised; only scam-like signals are hard failures. */
export function assessQuality(input: QualityInput): QualityResult {
  const flags: string[] = [];
  const hardFlags: string[] = [];
  const title = input.title?.trim() ?? '';
  const desc = normalizeForMatch(input.description ?? '');

  if (!title || title.length < 3) hardFlags.push('missing_title');
  if (isPlaceholderCompany(input.company)) hardFlags.push('missing_employer');
  if (!isHttpUrl(input.jobUrl)) hardFlags.push('invalid_job_url');
  if (input.applyUrl && !isHttpUrl(input.applyUrl)) flags.push('invalid_apply_url');
  if (GENERIC_TITLES.test(title)) hardFlags.push('generic_title');

  for (const [re, label] of SCAM_PATTERNS) {
    if (re.test(desc)) hardFlags.push(`suspicious:${label}`);
  }

  if (!input.description || input.description.trim().length < 40) flags.push('no_description');
  else if (input.descriptionIsSnippet) flags.push('snippet_only');

  let applyDomainMatchesCompany = false;
  if (input.applyUrl && input.company && !input.atsProvider && !isJobBoardUrl(input.applyUrl)) {
    const domain = registrableDomain(input.applyUrl) ?? '';
    const tokens = companyTokens(input.company);
    applyDomainMatchesCompany = tokens.some((t) => domain.includes(t));
    if (!applyDomainMatchesCompany && tokens.length > 0) flags.push('apply_domain_differs_from_employer');
  }

  return { flags: [...flags, ...hardFlags], hardFlags, applyDomainMatchesCompany };
}
