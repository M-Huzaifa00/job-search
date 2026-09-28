import type { ListingType } from '../../models/job.ts';
import { normalizeForMatch } from '../../utils/text.ts';

const STAFFING_NAMES =
  /\b(robert\s+half|aerotek|kforce|insight\s+global|teksystems|randstad|adecco|kelly(\s+services)?|manpower(group)?|express\s+employment|apex\s+systems|cybercoders|beacon\s+hill|actalent|vaco|amn\s+healthcare|cross\s+country|medical\s+solutions|aya\s+healthcare|maxim\s+healthcare|jobot|lancesoft|mindlance|collabera|pyramid\s+consulting|infojini|hire\s+talent|atc\s+healthcare|vivian|trusted\s+health|nursefinders|onward\s+search|ettain|akkodis|spherion|appleone|volt|yoh|allegis|hays|michael\s+page|korn\s+ferry|staffmark|ascend\s+staffing|healthcare\s+staffing|advantis|triage\s+staffing|soliant|integrity\s+staffing|the\s+judge\s+group|net2source|diverse\s+lynx|intellipro|russell\s+tobin|tandym|hirequest)\b/;
const STAFFING_WORDS = /\b(staffing|recruiting|recruitment|recruiters|talent\s+solutions|workforce\s+solutions|search\s+group|placement(s)?|personnel|employment\s+agency|headhunt\w*)\b/;
const STAFFING_DESC =
  /\b(on\s+behalf\s+of\s+(our|a)\s+client|our\s+client,?\s+(a|an|is)|our\s+client\s+is\s+seeking|contract[\s-]to[\s-]hire|w2\s+contract|c2c|corp[\s-]to[\s-]corp|we\s+are\s+a\s+staffing|staffing\s+(agency|firm|company))\b/;

/** Aggregators and repost farms that commonly appear as the "company" on LinkedIn and similar sites. */
const JOB_BOARD_COMPANIES =
  /^(jobs\s+via\s+\w+|lensa|jobgether|talentify(\.io)?|recruit\.net|jobright(\.ai)?|tietalent|jobleads|jobs\s+for\s+humanity|hiring\s+cafe|jooble|careerjet|ziprecruiter|dice|indeed|simplyhired|talent\.com|adzuna|jobs2careers|myjobhelper|snagajob|joblist|jobcase|bebee|ladders|efinancialcareers|clearancejobs|remote\s*hunter|remotive|jobicy|remoteok|virtual\s+vocations|flexjobs|we\s+work\s+remotely|jobs\s+ai|job\s+board)$/i;

export function isJobBoardCompany(company: string | null | undefined): boolean {
  if (!company) return false;
  return JOB_BOARD_COMPANIES.test(company.trim());
}

export function classifyListingType(input: { company: string | null; description: string | null; atsProvider: string | null; applyDomainMatchesCompany: boolean }): ListingType {
  const company = normalizeForMatch(input.company ?? '');
  if (!company) return 'unknown';
  if (isJobBoardCompany(input.company)) return 'job_board';
  if (STAFFING_NAMES.test(company) || STAFFING_WORDS.test(company)) return 'staffing_agency';
  const desc = normalizeForMatch(input.description ?? '').slice(0, 6_000);
  if (STAFFING_DESC.test(desc)) return 'staffing_agency';
  if (input.atsProvider || input.applyDomainMatchesCompany) return 'direct_employer';
  // A named company posting on a board, with no staffing signals, is most likely the employer itself.
  return 'direct_employer';
}
