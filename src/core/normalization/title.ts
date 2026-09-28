import { normalizeForMatch } from '../../utils/text.ts';
import { US_STATES } from '../geo.ts';

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bsr\b\.?/g, 'senior'],
  [/\bjr\b\.?/g, 'junior'],
  [/\bspec\b\.?/g, 'specialist'],
  [/\breps?\b\.?/g, 'representative'],
  [/\bcoord\b\.?/g, 'coordinator'],
  [/\bmgr\b\.?/g, 'manager'],
  [/\basst\b\.?/g, 'assistant'],
  [/\bassoc\b\.?/g, 'associate'],
  [/\badmin\b\.?/g, 'administrator'],
  [/\ba\s*\/\s*r\b/g, 'accounts receivable'],
  [/\brcm\b/g, 'revenue cycle management'],
  [/\biv\b/g, '4'],
  [/\biii\b/g, '3'],
  [/\bii\b/g, '2'],
  [/\bi$/g, '1'],
];

/** Words that describe *where/how* the job is done rather than *what* it is. */
const NOISE =
  /\b(100\s*%|fully|full[\s-]?time|part[\s-]?time|remote(ly)?|work\s+from\s+home|wfh|telecommute|telework|virtual|hybrid|on[\s-]?site|nationwide|anywhere|united\s+states|usa|us|contract|temp(orary)?|per\s+diem|prn|days|nights|evenings|weekends?|shift|urgent(ly)?|hiring|immediate(ly)?|now|new)\b/g;

const STATE_WORDS = [...Object.values(US_STATES).map((s) => s.toLowerCase()), ...Object.keys(US_STATES).map((s) => s.toLowerCase())]
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/ /g, '\\s+'));
/** A trailing " - Texas" / ", TX" / "| Remote, FL" location qualifier. */
const TRAILING_LOCATION = new RegExp(`\\s*[-–|,:]\\s*(remote\\s*[-–,]?\\s*)?(${STATE_WORDS.join('|')})\\s*$`);

/**
 * Canonical title for duplicate detection:
 * "Medical Billing Specialist - Remote" and "REMOTE Medical Billing Specialist" -> "medical billing specialist".
 */
export function normalizeTitle(title: string): string {
  let t = normalizeForMatch(title);
  // Drop requisition numbers / job codes.
  t = t.replace(/\b(req(uisition)?|job)\s*(id|#|no\.?|number)?\s*[:#]\s*[a-z]*[-_]?\d[\w-]*/g, ' ');
  t = t.replace(/\b(req|jr|r)[-_]?\d{4,}\b/g, ' ');
  t = t.replace(/#\s*\w+/g, ' ');
  // Bracketed qualifiers "(Remote)", "[Hybrid]", "(Texas)" are location/schedule noise.
  t = t.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  for (let i = 0; i < 2; i++) t = t.replace(TRAILING_LOCATION, ' ');
  t = t.replace(/&/g, ' and ');
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9 ]+/g, ' ');
  t = t.replace(NOISE, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\bi$/, '1');
  return t;
}
