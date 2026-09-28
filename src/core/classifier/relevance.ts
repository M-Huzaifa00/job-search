import { normalizeForMatch } from '../../utils/text.ts';

export interface RelevanceInput {
  title: string;
  description: string | null;
  company: string | null;
  tags?: string[];
}

export type MatchVia = 'title_exact' | 'title_pattern' | 'title_context' | 'description';

export interface TermMatch {
  term: string;
  score: number;
  via: MatchVia;
}

export interface RelevanceResult {
  relevant: boolean;
  matched_keyword: string | null;
  matched_keywords: string[];
  category: string | null;
  keyword_confidence: number;
  medical_role_score: number;
  healthcare_context: number;
  coding_context: number;
  excluded_reason: string | null;
  matches: TermMatch[];
}

interface TermRule {
  category: string;
  /** Title patterns that identify the role on their own. */
  strong: RegExp[];
  /** Title patterns that need healthcare context (and optionally a description requirement). */
  contextual?: RegExp[];
  contextualNeedsDesc?: RegExp;
  /** Minimum healthcare-context hits for contextual title matches. */
  minContext?: number;
  /** Minimum coding-context hits (ICD-10, CPT, ...) — used by coder/coding rules. */
  minCodingContext?: number;
  /** Strong patterns that still need at least this much healthcare context. */
  strongMinContext?: number;
  /** Description phrases that make an administrative-family title relevant. */
  description?: RegExp[];
  /** The generic "software" word is acceptable for this rule (EHR software support). */
  allowSoftware?: boolean;
}

const ROLE = String.raw`(specialist|representative|rep|coordinator|analyst|associate|clerk|manager|supervisor|lead|director|assistant|technician|auditor|consultant|officer|administrator|processor|agent|expert)`;
const EHR_SYSTEMS = String.raw`(ehr|emr|electronic\s+(health|medical)\s+records?|epic|cerner|athena(health)?|eclinicalworks|ecw|nextgen|meditech|allscripts|oracle\s+health|kareo|advancedmd|practice\s+fusion)`;
const CODER_QUALIFIER = String.raw`(medical|certified|inpatient|outpatient|profee|pro[\s-]?fee|professional\s+fee|hcc|risk\s+adjustment|surgical|surgery|radiology|ed|emergency(\s+department)?|e\/m|cardiology|oncology|orthopedic|anesthesia|hospital|physician|facility|clinical|coding|home\s+health|hospice|behavioral\s+health|dental|pathology|ambulatory|interventional|trauma|observation|denials)`;
const CODING_CERTS = /\b(cpc|ccs|ccs-p|rhit|rhia|coc|cic|crc|cca|cpc-a)\b/;

const BILLING = /\bbill(ing|er|ers)\b/;
const CREDENTIALING = String.raw`credential(ing|ling|er)`;

/** Rules for the default search terms. Unknown user terms fall back to generic phrase matching. */
const TERM_RULES: Record<string, TermRule> = {
  'medical billing': {
    category: 'Medical Billing',
    strong: [/\bmedical\s+bill(ing|er)\b/, /\b(healthcare|hospital|physician|clinical|professional|patient|practice|behavioral\s+health|dental|facility|pharmacy)\s+billing\b/],
    contextual: [BILLING, /\bclaims?\s+(specialist|representative|rep|analyst|processor|examiner|coordinator|associate)\b/],
    minContext: 2,
    description: [/\bmedical\s+billing\b/, /\b(cms[\s-]?1500|ub[\s-]?04|clearinghouse|claims?\s+submission|insurance\s+claims)\b/],
  },
  'medical biller': {
    category: 'Medical Billing',
    strong: [/\bmedical\s+biller\b/, /\b(certified|healthcare|hospital|physician|dental|professional)\s+biller\b/],
    contextual: [/\bbillers?\b/],
    minContext: 2,
    description: [/\bmedical\s+biller\b/],
  },
  'medical billing specialist': {
    category: 'Medical Billing',
    strong: [/\bmedical\s+billing\s+specialist\b/],
    contextual: [/\bbilling\s+(specialist|representative|rep|associate)\b/],
    minContext: 2,
  },
  'medical billing insurance': {
    category: 'Medical Billing',
    strong: [/\binsurance\s+billing\b/, /\bbilling\s+(and|&|\/)\s+insurance\b/, /\binsurance\s+(and|&|\/)\s+billing\b/, /\bmedical\s+billing\s+(and|&|\/)\s+insurance\b/],
    contextual: [BILLING],
    contextualNeedsDesc: /\binsurance\b/,
    minContext: 2,
  },
  'revenue cycle': {
    category: 'Revenue Cycle',
    strong: [/\brevenue\s+cycle\b/, /\brcm\b/],
    description: [/\brevenue\s+cycle\b/],
  },
  'revenue cycle specialist': {
    category: 'Revenue Cycle',
    strong: [/\b(revenue\s+cycle|rcm)\s+(specialist|analyst|representative|rep|associate)\b/],
  },
  'revenue cycle coordinator': {
    category: 'Revenue Cycle',
    strong: [/\b(revenue\s+cycle|rcm)\s+coordinator\b/],
  },
  'rcm billing': {
    category: 'Revenue Cycle',
    strong: [/\b(rcm|revenue\s+cycle)\b.*\bbill(ing|er)\b/, /\bbill(ing|er)\b.*\b(rcm|revenue\s+cycle)\b/],
    contextual: [BILLING],
    contextualNeedsDesc: /\b(rcm|revenue\s+cycle)\b/,
    minContext: 2,
  },
  'credentialing specialist': {
    category: 'Credentialing',
    strong: [new RegExp(String.raw`\b${CREDENTIALING}\s+(specialist|analyst|associate|representative|rep)\b`)],
  },
  'credentialing coordinator': {
    category: 'Credentialing',
    strong: [new RegExp(String.raw`\b${CREDENTIALING}\s+coordinator\b`)],
  },
  'medical credentialing': {
    category: 'Credentialing',
    strong: [new RegExp(String.raw`\b(medical|provider|physician|healthcare|clinical|payer|payor|medical\s+staff|hospital)\s+${CREDENTIALING}\b`)],
    contextual: [new RegExp(String.raw`\b${CREDENTIALING}\b`), /\bprivileging\b/],
    minContext: 1,
    description: [/\b(provider|physician|medical)\s+credentialing\b/],
  },
  'provider credentialing': {
    category: 'Credentialing',
    strong: [new RegExp(String.raw`\b(provider|physician|practitioner|medical\s+staff)\s+${CREDENTIALING}\b`)],
    contextual: [new RegExp(String.raw`\b${CREDENTIALING}\b`)],
    contextualNeedsDesc: /\b(providers?|physicians?|practitioners?|caqh|npi|clinicians?)\b/,
    minContext: 1,
    description: [/\bprovider\s+credentialing\b/],
  },
  'provider enrollment': {
    category: 'Credentialing',
    strong: [/\b(provider|payer|payor|insurance|medicare|medicaid|network)\s+enrollment\b/],
    contextual: [new RegExp(String.raw`\benrollment\s+${ROLE}\b`)],
    contextualNeedsDesc: /\b(providers?|payers?|payors?|caqh|npi|medicare|medicaid|credentialing|pecos)\b/,
    minContext: 2,
    description: [/\b(provider|payer|payor)\s+enrollment\b/],
  },
  'medical coding': {
    category: 'Medical Coding',
    strong: [
      new RegExp(String.raw`\b${CODER_QUALIFIER}\s+cod(ing|er)\b`),
      new RegExp(String.raw`\bcoding\s+(specialist|analyst|auditor|validator|educator|manager|supervisor|lead|coordinator|quality|compliance|integrity|professional|associate)\b`),
      CODING_CERTS,
    ],
    strongMinContext: 0,
    contextual: [/\bcod(ing|er)\b/],
    minCodingContext: 2,
    description: [/\bmedical\s+coding\b/],
  },
  'medical coder': {
    category: 'Medical Coding',
    strong: [new RegExp(String.raw`\b${CODER_QUALIFIER}\s+coder\b`), CODING_CERTS],
    contextual: [/\bcoders?\b/],
    minCodingContext: 2,
  },
  'medical billing coding': {
    category: 'Medical Billing',
    strong: [/\bbill(ing|er)\s*(and|&|\/|-)\s*cod(ing|er)\b/, /\bcod(ing|er)\s*(and|&|\/|-)\s*bill(ing|er)\b/],
    contextual: [BILLING, /\bcod(ing|er)\b/],
    contextualNeedsDesc: /\b(medical\s+coding|icd[\s-]?10|cpt)\b.*\bbilling\b|\bbilling\b.*\b(medical\s+coding|icd[\s-]?10|cpt)\b/s,
    minContext: 2,
  },
  'reimbursement specialist': {
    category: 'Collections / Reimbursement',
    strong: [new RegExp(String.raw`\breimbursement\s+${ROLE}\b`)],
    strongMinContext: 1,
    description: [/\breimbursement\s+specialist\b/],
  },
  'medical collections': {
    category: 'Collections / Reimbursement',
    strong: [/\b(medical|patient|healthcare|hospital|insurance|physician|clinical)\s+(collections?|collectors?)\b/],
    contextual: [
      /\bcollections?\b|\bcollectors?\b/,
      /\b(a\/r|ar|accounts\s+receivable)\s+(specialist|representative|rep|analyst|associate|follow[\s-]?up|coordinator|clerk)\b/,
      /\bdenials?\s+(specialist|analyst|management|representative|coordinator)\b/,
      /\binsurance\s+follow[\s-]?up\b/,
    ],
    minContext: 2,
    description: [/\bmedical\s+collections?\b/],
  },
  'medical insurance coordinator': {
    category: 'Insurance',
    strong: [
      /\b(medical|health)\s+insurance\s+(coordinator|specialist|verification|representative)\b/,
      /\binsurance\s+(verification|authorization|eligibility)\s+(specialist|coordinator|representative|rep|associate)\b/,
      /\b(benefits?|eligibility)\s+verification\b/,
      /\bprior\s+auth(orization)?s?\s+(specialist|coordinator|representative|rep|associate)\b/,
    ],
    contextual: [/\binsurance\s+(coordinator|specialist|representative|verifier)\b/, /\bauthorization\s+(specialist|coordinator|representative)\b/],
    minContext: 2,
    description: [/\binsurance\s+verification\b/, /\bprior\s+authorizations?\b/],
  },
  'ehr support specialist': {
    category: 'EHR Support',
    strong: [new RegExp(String.raw`\b${EHR_SYSTEMS}\s+(\w+\s+){0,2}(support|specialist|analyst|trainer|technician|coordinator|help\s*desk|administrator|consultant|implementation)\b`)],
    contextual: [/\b(clinical\s+applications?|applications?|help\s*desk|service\s+desk|technical|it|systems?)\s+(support|analyst|specialist)\b/],
    contextualNeedsDesc: new RegExp(String.raw`\b${EHR_SYSTEMS}\b`),
    minContext: 1,
    allowSoftware: true,
  },
};

const EXCLUDE_ENGINEERING =
  /\b(developer|engineer|engineering|programmer|devops|sre|full[\s-]?stack|front[\s-]?end|back[\s-]?end|data\s+scientist|machine\s+learning|ml\s+engineer|ai\s+engineer|architect|sdet|qa\s+automation)\b/;
const EXCLUDE_SOFTWARE = /\bsoftware\b/;
const EXCLUDE_PROGRAMMING = /\b(python|java|javascript|typescript|golang|ruby|php|c\+\+|c#|\.net|react|node\.?js|kotlin|swift|scala|rust|sql\s+developer)\b/;
const EXCLUDE_TEACHING = /\b(instructor|teacher|tutor|professor|faculty|curriculum|bootcamp|lecturer)\b/;
const EXCLUDE_SALES = /\b(sales|account\s+executive|business\s+development|marketing|recruiter|talent\s+acquisition|sourcer)\b/;
const EXCLUDE_CLINICAL =
  /\b(registered\s+nurse|nurse|rn|lpn|lvn|nurse\s+practitioner|physician\s+assistant|therapist|pharmacist|dentist|hygienist|surgeon|technologist|phlebotomist|caregiver|cna|medical\s+assistant|scribe)\b/;

/** Administrative healthcare-business titles that may be relevant based on the description. */
const ADMIN_FAMILY =
  /\b(billing|biller|coder|coding|credential\w*|enrollment|revenue|rcm|reimbursement|collections?|collector|claims?|insurance|a\/r|accounts\s+receivable|posting|denials?|authorization|verification|patient\s+(account|access|financial|services)|ehr|emr|him|health\s+information|medical\s+records?|charge|pay[eo]r|appeals?|follow[\s-]?up|cash\s+applications?|payment|financial\s+counselor|registration)\b/;

const HEALTHCARE_TERMS: RegExp[] = [
  /\bpatients?\b/,
  /\bproviders?\b/,
  /\bphysicians?\b/,
  /\bhospitals?\b/,
  /\bclinics?\b|\bclinical\b/,
  /\bhealth\s?care\b/,
  /\bmedical\b/,
  /\bpay[eo]rs?\b/,
  /\bmedicare\b/,
  /\bmedicaid\b/,
  /\bhipaa\b/,
  /\b(ehr|emr)\b/,
  /\b(epic|cerner|athenahealth|eclinicalworks|nextgen|meditech|kareo|advancedmd|allscripts)\b/,
  /\bcpt\b/,
  /\bicd[\s-]?10\b|\bicd\b/,
  /\bhcpcs\b/,
  /\bdenials?\b/,
  /\beobs?\b|\bexplanation\s+of\s+benefits\b/,
  /\bcms[\s-]?1500\b|\bub[\s-]?04\b/,
  /\bprior\s+auth(orization)?s?\b/,
  /\bcredentialing\b/,
  /\bcaqh\b/,
  /\bnpi\b/,
  /\brevenue\s+cycle\b/,
  /\binsurance\s+(claims?|verification|companies|carriers)\b/,
  /\bpharmacy\b/,
  /\bdental\b/,
  /\bbehavioral\s+health\b/,
  /\bhome\s+health\b/,
  /\bhospice\b/,
  /\bskilled\s+nursing\b/,
  /\bambulatory\b/,
  /\bhealth\s+(system|plan|information)\b/,
  /\btherap(y|ist|ists)\b/,
  /\bdiagnos(is|es|tic)\b/,
];

const CODING_TERMS: RegExp[] = [
  /\bicd[\s-]?10(-cm|-pcs)?\b/,
  /\bcpt\b/,
  /\bhcpcs\b/,
  /\bdrgs?\b/,
  /\be\/m\b|\bevaluation\s+and\s+management\b/,
  /\bmedical\s+records?\b/,
  CODING_CERTS,
  /\baapc\b/,
  /\bahima\b/,
  /\bhcc\b|\bhierarchical\s+condition\b/,
  /\brisk\s+adjustment\b/,
  /\bcoding\s+(certification|guidelines|compliance|accuracy|audits?)\b/,
  /\bmodifiers?\b/,
  /\bchart\s+(review|abstraction|audits?)\b/,
  /\bmedical\s+coding\b/,
  /\bclaims?\b/,
  /\breimbursement\b/,
  /\binpatient\b|\boutpatient\b/,
];

const STOPWORDS = new Set(['and', 'or', 'the', 'of', 'for', 'in', 'a', 'an', 'to', 'with']);

function countHits(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) if (p.test(text)) n++;
  return n;
}

function normTerm(term: string): string {
  return normalizeForMatch(term).replace(/[^a-z0-9/&+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function genericMatch(term: string, title: string, desc: string): TermMatch | null {
  const phrase = normTerm(term);
  if (!phrase) return null;
  const tokens = phrase.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const titleTokens = new Set(title.split(/[^a-z0-9]+/));
  if (new RegExp(`\\b${escapeRe(phrase)}\\b`).test(title)) return { term, score: 0.9, via: 'title_exact' };
  if (tokens.length > 0 && tokens.every((t) => titleTokens.has(t))) return { term, score: 0.75, via: 'title_pattern' };
  if (new RegExp(`\\b${escapeRe(phrase)}\\b`).test(desc) && tokens.some((t) => titleTokens.has(t))) return { term, score: 0.55, via: 'description' };
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
}

export function knownTerm(term: string): boolean {
  return normTerm(term) in TERM_RULES;
}

/**
 * Contextual keyword matching. A job is relevant when at least one requested term matches the
 * title (directly, or with healthcare context) or — for administrative titles — the description.
 */
export function classifyRelevance(input: RelevanceInput, terms: string[]): RelevanceResult {
  const title = normalizeForMatch(input.title);
  const desc = normalizeForMatch([input.description ?? '', ...(input.tags ?? [])].join('\n')).slice(0, 12_000);
  const company = normalizeForMatch(input.company ?? '');
  const contextText = `${title}\n${company}\n${desc}`;
  const healthcare = countHits(contextText, HEALTHCARE_TERMS);
  const coding = countHits(`${title}\n${desc}`, CODING_TERMS);

  const matches: TermMatch[] = [];
  let excludedReason: string | null = null;

  const engineering = EXCLUDE_ENGINEERING.test(title) || EXCLUDE_PROGRAMMING.test(title);
  const teaching = EXCLUDE_TEACHING.test(title);
  const sales = EXCLUDE_SALES.test(title);
  const software = EXCLUDE_SOFTWARE.test(title);
  const clinical = EXCLUDE_CLINICAL.test(title);

  for (const rawTerm of terms) {
    const key = normTerm(rawTerm);
    const rule = TERM_RULES[key];
    if (!rule) {
      const g = genericMatch(rawTerm, title, desc);
      if (g) matches.push(g);
      continue;
    }

    // Hard exclusions: software/programming, teaching and sales roles never match medical terms.
    if (engineering) {
      excludedReason = 'software/engineering title';
      continue;
    }
    if (software && !rule.allowSoftware) {
      excludedReason = 'software title';
      continue;
    }
    if (teaching) {
      excludedReason = 'teaching/instructor title';
      continue;
    }
    if (sales) {
      excludedReason = 'sales/marketing/recruiting title';
      continue;
    }

    let match: TermMatch | null = null;
    if (new RegExp(`\\b${escapeRe(key)}\\b`).test(title) && healthcare >= (rule.strongMinContext ?? 0)) {
      match = { term: rawTerm, score: 1, via: 'title_exact' };
    } else if (rule.strong.some((re) => re.test(title)) && healthcare >= (rule.strongMinContext ?? 0)) {
      match = { term: rawTerm, score: 0.92, via: 'title_pattern' };
    } else if (rule.contextual?.some((re) => re.test(title))) {
      const ctxOk = healthcare >= (rule.minContext ?? 0) && coding >= (rule.minCodingContext ?? 0);
      const descOk = !rule.contextualNeedsDesc || rule.contextualNeedsDesc.test(desc) || rule.contextualNeedsDesc.test(title);
      if (ctxOk && descOk) match = { term: rawTerm, score: 0.8, via: 'title_context' };
    }
    if (!match && rule.description && ADMIN_FAMILY.test(title) && healthcare >= 2 && rule.description.some((re) => re.test(desc))) {
      match = { term: rawTerm, score: 0.6, via: 'description' };
    }
    // Clinical titles only count when the title itself names the administrative role.
    if (match && clinical && match.via !== 'title_exact' && match.via !== 'title_pattern') {
      excludedReason = 'clinical title';
      match = null;
    }
    if (match) matches.push(match);
  }

  matches.sort((a, b) => b.score - a.score || b.term.length - a.term.length);
  const best = matches[0] ?? null;
  const bestKey = best ? normTerm(best.term) : null;
  const rule = bestKey ? TERM_RULES[bestKey] : undefined;
  const keywordConfidence = best ? best.score : 0;
  const medicalRoleScore = round(0.6 * keywordConfidence + 0.4 * Math.min(1, healthcare / 5));
  const relevant = !!best && (rule ? keywordConfidence >= 0.6 && medicalRoleScore >= 0.5 : keywordConfidence >= 0.55);

  return {
    relevant,
    matched_keyword: best?.term ?? null,
    matched_keywords: matches.map((m) => m.term),
    category: rule?.category ?? (best ? 'Custom' : null),
    keyword_confidence: round(keywordConfidence),
    medical_role_score: medicalRoleScore,
    healthcare_context: healthcare,
    coding_context: coding,
    excluded_reason: relevant ? null : (excludedReason ?? (best ? 'insufficient healthcare context' : 'no keyword match')),
    matches,
  };
}

/** Cheap title-only pre-screen used before spending a request on a detail page. */
export function titleLooksRelevant(title: string, terms: string[]): boolean {
  const t = normalizeForMatch(title);
  if (EXCLUDE_ENGINEERING.test(t) || EXCLUDE_PROGRAMMING.test(t) || EXCLUDE_TEACHING.test(t) || EXCLUDE_SALES.test(t)) return false;
  if (ADMIN_FAMILY.test(t)) return true;
  for (const term of terms) {
    const rule = TERM_RULES[normTerm(term)];
    if (rule) {
      if (rule.strong.some((re) => re.test(t)) || rule.contextual?.some((re) => re.test(t))) return true;
    } else if (genericMatch(term, t, '')) {
      return true;
    }
  }
  return false;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
