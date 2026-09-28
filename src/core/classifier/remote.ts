import type { RemoteHint, RemoteType } from '../../models/job.ts';

export interface RemoteInput {
  title: string;
  location: string | null;
  /** Plain-text description (or snippet). */
  description: string | null;
  hints: RemoteHint[];
}

export interface RemoteClassification {
  remote_type: RemoteType;
  confidence: number;
  evidence: string[];
  notes: string[];
}

interface Rule {
  re: RegExp;
  label: string;
  weight?: number;
}

const ONSITE_WORD = String.raw`(?:on[\s-]?site|onsite|in[\s-]?office|in[\s-]person|in\s+the\s+office|at\s+(?:the|our)\s+(?:office|facility|clinic|hospital))`;
const NUM = String.raw`(?:\d|one|two|three|four|five|a\s+few|several)`;
const DAY = String.raw`(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?`;

const POSITIVE_DESC: Rule[] = [
  { re: /\b(100\s*%|fully|completely|entirely|totally|permanently|full[\s-]?time)\s+remote\b/i, label: 'fully remote', weight: 3 },
  { re: /\bremote\s*[-–,:(/]?\s*(u\.?s\.?a?\.?|united states|nationwide)\b/i, label: 'remote US', weight: 3 },
  { re: /\b(u\.s\.a?\.?|usa|united states)\s*[-–,(/]?\s*remote\b/, label: 'US remote', weight: 3 },
  { re: /\b(this|the)\s+(is\s+an?|position\s+is(\s+an?)?|role\s+is(\s+an?)?|job\s+is(\s+an?)?|opportunity\s+is(\s+an?)?)\s+(fully\s+|100%\s+)?remote\b/i, label: 'role is remote', weight: 3 },
  { re: /\b(work\s+)?location\s*:\s*(fully\s+|100%\s+)?remote\b/i, label: 'location: remote', weight: 3 },
  { re: /\bwork(ing)?\s+(from|at)\s+home\b|\bwfh\b/i, label: 'work from home', weight: 2 },
  { re: /\bhome[\s-]based\b/i, label: 'home-based', weight: 2 },
  { re: /\bremote\s+(position|role|opportunity|job|work|employee|team\s+member|based|first|environment|setting|worker|status)\b/i, label: 'remote position', weight: 2 },
  { re: /\btelecommut(e|ing)\b|\btelework\b/i, label: 'telecommute', weight: 2 },
  { re: /\bwork\s+from\s+anywhere\b/i, label: 'work from anywhere', weight: 2 },
];

const HYBRID_DESC: Rule[] = [
  { re: /\bhybrid\s+(role|position|schedule|work(ing)?|model|arrangement|environment|opportunity|remote|setting|format|basis|job|team|structure|policy)\b/i, label: 'hybrid schedule' },
  { re: /\b(is|as)\s+an?\s+hybrid\b|\b(work\s+)?location\s*:\s*hybrid\b/i, label: 'role is hybrid' },
  { re: /\bremote\s*\/\s*hybrid\b|\bhybrid\s*\/\s*remote\b|\bhybrid[\s-]remote\b|\bremote[\s-]hybrid\b/i, label: 'remote/hybrid' },
  {
    re: new RegExp(String.raw`\b${NUM}\s*(\+\s*)?(days?|times?)\s*(a|per|each|every|/)?\s*(week|wk|month)?\s*(in|at|on|from)\s*(the|our)?\s*(office|site|onsite|on-site|clinic|hospital|facility|location|campus|hq|headquarters)\b`, 'i'),
    label: 'N days in office',
  },
  { re: new RegExp(String.raw`\b${ONSITE_WORD}\s+(\w+\s+){0,3}${NUM}\s*(\+\s*)?(days?|times?)\b`, 'i'), label: 'onsite N days' },
  { re: new RegExp(String.raw`\b${ONSITE_WORD}\s+(every|each|once|twice|on)\s+(${DAY}|week|month|other|quarter)`, 'i'), label: 'onsite on specific days' },
  { re: new RegExp(String.raw`\b(every|each|on)\s+${DAY}\s+(\w+\s+){0,3}${ONSITE_WORD}`, 'i'), label: 'onsite on specific days' },
  { re: /\boccasional(ly)?\s+(\w+\s+){0,4}(office|on[\s-]?site|onsite|in[\s-]person)\b/i, label: 'occasional office attendance' },
  { re: /\b(periodic|quarterly|monthly|weekly|regular)\s+(\w+\s+){0,2}(office|on[\s-]?site|onsite|in[\s-]person)\s+(visits?|meetings?|attendance|presence|days?|work)\b/i, label: 'periodic office attendance' },
  { re: /\b(come|report|travel)\s+(in)?to\s+(the|our)\s+office\s+(as\s+needed|when\s+needed|periodically|occasionally|regularly)\b/i, label: 'office as needed' },
  { re: /\b(must|required\s+to|expected\s+to|will\s+need\s+to|need\s+to|able\s+to)\s+(\w+\s+){0,3}commute\b/i, label: 'commute required' },
  { re: /\bwithin\s+(a\s+)?(reasonable\s+)?(commut(ing|able)\s+distance|\d+\s*(miles?|mi\.?|km))\s+(of|from|to)\b/i, label: 'must live near office' },
  { re: /\b(local\s+candidates\s+only|must\s+be\s+local|must\s+(live|reside)\s+locally|locals?\s+only|must\s+be\s+local\s+to)\b/i, label: 'local candidates only' },
];

const ONSITE_DESC: Rule[] = [
  {
    re: /\b(this|the)\s+(is\s+an?|position\s+is(\s+an?)?|role\s+is(\s+an?)?|job\s+is(\s+an?)?)\s+(\w+\s+)?(on[\s-]?site|onsite|in[\s-]office|in[\s-]person|office[\s-]based)\b/i,
    label: 'role is onsite',
  },
  {
    re: /\b(not\s+(a\s+)?remote|no\s+remote|non[\s-]remote|remote\s+work\s+is\s+not\s+(available|permitted|an\s+option|offered)|not\s+eligible\s+for\s+remote|not\s+a\s+work[\s-]from[\s-]home|remote\s*(work)?\s*:\s*no)\b/i,
    label: 'explicitly not remote',
  },
  { re: /\b(work\s+)?location\s*:\s*(in[\s-]person|on[\s-]?site|onsite|in[\s-]office)\b/i, label: 'location: in person' },
  { re: /\brelocation\s+(is\s+)?required\b|\bmust\s+(be\s+willing\s+to\s+)?relocate\b/i, label: 'relocation required' },
  { re: /\boffice[\s-]based\b/i, label: 'office-based' },
  {
    re: /\b(must|required\s+to|expected\s+to|will)\s+(\w+\s+){0,3}(work|report|be\s+present|be\s+physically\s+present)\s+(\w+\s+){0,3}(on[\s-]?site|onsite|in\s+(the|our)\s+office|in[\s-]person|at\s+(the|our)\s+(office|facility|clinic|hospital))\b/i,
    label: 'must work onsite',
  },
];

const TRAINING_ONSITE =
  /\b(on[\s-]?site|onsite|in[\s-]office|in[\s-]person)\s+(\w+\s+){0,2}(training|orientation|onboarding)\b|\b(training|orientation|onboarding)\s+(\w+\s+){0,5}(on[\s-]?site|onsite|in[\s-]office|in[\s-]person|in\s+the\s+office)\b/i;
const THEN_REMOTE =
  /\b(then|after(wards)?|followed\s+by|thereafter|upon\s+completion|once\s+(training|orientation|onboarding)\s+is\s+complete[d]?|transition(ing|s)?\s+to|before\s+(moving|transitioning)\s+to)\b[^.]{0,90}\b(remote|work\s+from\s+home)\b|\b(remote|work\s+from\s+home)\s+after\s+(\w+\s+){0,4}(training|orientation|onboarding|days?|weeks?|months?|probation)/i;

const TITLE_LOC_REMOTE = /\b(remote|work\s+from\s+home|wfh|telecommute|telework|home[\s-]based|virtual)\b/i;
const TITLE_LOC_HYBRID = /\bhybrid\b/i;
const TITLE_LOC_ONSITE = /\b(on[\s-]?site|onsite|in[\s-]office|in[\s-]person|office[\s-]based)\b/i;

const NEGATION_BEFORE = /\b(no|not|never|without|non|zero|isn't|is\s+not|aren't|nor|n't)\b[\w\s,'-]{0,18}$/i;
const NEGATION_AFTER = /^[^.;]{0,30}\b(is|are)?\s*(not|never)\s+(required|necessary|needed|expected|mandatory)\b/i;

function isNegated(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 30), index);
  const after = text.slice(index + length, index + length + 45);
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after);
}

function matchRules(text: string, rules: Rule[]): { label: string; weight: number; snippet: string }[] {
  const out: { label: string; weight: number; snippet: string }[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    for (const m of text.matchAll(re)) {
      if (isNegated(text, m.index, m[0].length)) continue;
      out.push({ label: rule.label, weight: rule.weight ?? 1, snippet: m[0].trim() });
      break;
    }
  }
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 0);
}

/**
 * Classifies the workplace type. Conservative by design: conflicting signals resolve to hybrid,
 * and a bare "remote" mention in a long description is not enough on its own.
 */
export function classifyRemote(input: RemoteInput): RemoteClassification {
  const evidence: string[] = [];
  const notes: string[] = [];
  const titleLoc = `${input.title} | ${input.location ?? ''}`;
  const desc = input.description ?? '';

  let positive = 0;
  const hybrid: string[] = [];
  const onsite: string[] = [];

  // --- Title / location field (strongest free-text signals) ---
  const tlRemote = titleLoc.match(TITLE_LOC_REMOTE);
  if (tlRemote && !isNegated(titleLoc, tlRemote.index!, tlRemote[0].length)) {
    positive += 3;
    evidence.push(`title/location: "${tlRemote[0]}"`);
  }
  const tlHybrid = titleLoc.match(TITLE_LOC_HYBRID);
  if (tlHybrid && !isNegated(titleLoc, tlHybrid.index!, tlHybrid[0].length)) hybrid.push('title/location says hybrid');
  const tlOnsite = titleLoc.match(TITLE_LOC_ONSITE);
  if (tlOnsite && !isNegated(titleLoc, tlOnsite.index!, tlOnsite[0].length)) onsite.push(`title/location says "${tlOnsite[0]}"`);
  // Titles sometimes carry the requirement itself: "Billing Coordinator (Must be local to Sacramento)".
  for (const h of matchRules(titleLoc, HYBRID_DESC)) hybrid.push(`title/location ${h.label}: "${h.snippet}"`);

  // --- Structured hints from the platform ---
  for (const h of input.hints) {
    if (h.kind === 'source_remote_filter') {
      positive += 2;
      evidence.push(`platform remote filter (${h.detail})`);
    } else if (h.kind === 'remote_only_board') {
      positive += 3;
      evidence.push(`remote-only board (${h.detail})`);
    } else if (h.kind === 'structured_remote') {
      positive += 3;
      evidence.push(`structured: ${h.detail}`);
    } else if (h.kind === 'structured_hybrid') {
      hybrid.push(`structured: ${h.detail}`);
    } else if (h.kind === 'structured_onsite') {
      onsite.push(`structured: ${h.detail}`);
    }
  }

  // --- Description ---
  if (desc) {
    const pos = matchRules(desc, POSITIVE_DESC);
    for (const p of pos) {
      positive += p.weight;
      evidence.push(`description: "${p.snippet}"`);
    }
    if (pos.length === 0 && /\bremote\b/i.test(desc)) {
      positive += 1;
      evidence.push('description mentions "remote"');
    }

    let temporaryTraining = false;
    for (const s of sentences(desc)) {
      if (!TRAINING_ONSITE.test(s)) continue;
      const idx = s.search(TRAINING_ONSITE);
      if (isNegated(s, idx, 12)) continue;
      if (THEN_REMOTE.test(s)) {
        temporaryTraining = true;
      } else {
        hybrid.push(`onsite training required: "${s.trim().slice(0, 120)}"`);
      }
    }
    if (!temporaryTraining && THEN_REMOTE.test(desc) && /\bremote\s+after\b/i.test(desc)) temporaryTraining = true;
    if (temporaryTraining) notes.push('temporary onsite training/onboarding before remote work');

    // Remove training sentences before scanning for onsite requirements so they are not double counted.
    const descNoTraining = temporaryTraining ? sentences(desc).filter((s) => !TRAINING_ONSITE.test(s) && !THEN_REMOTE.test(s)).join(' ') : desc;
    for (const h of matchRules(descNoTraining, HYBRID_DESC)) hybrid.push(`${h.label}: "${h.snippet}"`);
    for (const o of matchRules(descNoTraining, ONSITE_DESC)) onsite.push(`${o.label}: "${o.snippet}"`);
  }

  // --- Decision ---
  if (hybrid.length > 0) {
    return { remote_type: 'hybrid', confidence: 0.9, evidence: [...hybrid, ...evidence], notes };
  }
  if (onsite.length > 0) {
    // A remote claim contradicted by an onsite requirement is treated as hybrid (conservative).
    return positive >= 2
      ? { remote_type: 'hybrid', confidence: 0.75, evidence: [...onsite, ...evidence], notes: [...notes, 'conflicting remote and onsite signals'] }
      : { remote_type: 'onsite', confidence: 0.85, evidence: onsite, notes };
  }
  const trainingPenalty = notes.length > 0 ? 0.1 : 0;
  if (positive >= 3) {
    const confidence = Math.min(0.99, 0.78 + 0.04 * (positive - 3)) - trainingPenalty;
    return { remote_type: 'fully_remote', confidence: round(confidence), evidence, notes };
  }
  if (positive === 2) return { remote_type: 'fully_remote', confidence: round(0.7 - trainingPenalty), evidence, notes };
  if (positive === 1) return { remote_type: 'unclear', confidence: 0.4, evidence, notes };
  return input.location && input.location.trim()
    ? { remote_type: 'onsite', confidence: 0.5, evidence: ['no remote indicators'], notes }
    : { remote_type: 'unclear', confidence: 0.3, evidence: ['no workplace information'], notes };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
