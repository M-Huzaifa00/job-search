import {
  INCLUDES_US_REGION_RE,
  NON_US_RE,
  STATE_NAME_RE,
  US_COUNTRY_RE,
  US_STATES,
  US_TOKEN_STRICT_RE,
  findNonUsPlaces,
  findUsStates,
} from '../geo.ts';

export interface LocationInput {
  location: string | null;
  title: string;
  description: string | null;
  applicantLocations?: string[];
  /** Country the platform search was restricted to. */
  countryHint?: 'US' | 'CA' | null;
}

export type LocationKind = 'us_nationwide' | 'us_states' | 'us_unspecified' | 'global' | 'multi_country' | 'non_us' | 'unknown';

export interface LocationClassification {
  us_eligible: boolean;
  kind: LocationKind;
  scope: string | null;
  states: string[];
  excluded_states: string[];
  evidence: string[];
  reason: string | null;
}

const NON_US_ALTERNATION = NON_US_RE.source.slice(3, -3); // strip the surrounding \b( ... )\b

const DESC_NON_US_REQUIRED = new RegExp(
  String.raw`\b(must|required\s+to|need\s+to|should|only)\s+(\w+\s+){0,3}(reside|live|be\s+located|be\s+based|be\s+physically\s+located)\s+(\w+\s+){0,3}(in|within)\s+(the\s+)?(${NON_US_ALTERNATION})\b` +
    String.raw`|\b(${NON_US_ALTERNATION})[\s-]based\s+(candidates|applicants|professionals|talent|freelancers|contractors)\b` +
    String.raw`|\bopen\s+(only\s+)?to\s+(candidates|applicants|residents|professionals)\s+(\w+\s+){0,2}(in|from)\s+(the\s+)?(${NON_US_ALTERNATION})\b`,
  'i',
);

const DESC_US_ELIGIBLE =
  /\b(open\s+to|available\s+to|eligible|hiring|accepting|welcome|considering)\s+(\w+\s+){0,4}(in|from|across|throughout|located\s+in|residing\s+in|based\s+in|anywhere\s+in)\s+(any\s+of\s+)?(all\s+50\s+(us\s+|u\.s\.\s+)?states|the\s+(u\.s\.|us|usa|united\s+states|continental\s+u\.?s\.?|lower\s+48)|u\.s\.|usa|united\s+states)|\banywhere\s+in\s+the\s+(u\.s\.|us|usa|united\s+states|country)\b|\b(all\s+50\s+states|nationwide\s+(remote|position|role)|remote\s+nationwide|us[\s-]wide)\b/i;

const DESC_US_REQUIRED =
  /\b(must|required\s+to|need\s+to)\s+(\w+\s+){0,3}(reside|live|be\s+located|be\s+based|work)\s+(\w+\s+){0,2}(in|within)\s+(the\s+)?(u\.s\.|us\b|usa|united\s+states|continental\s+u\.?s\.?|contiguous|lower\s+48)/i;

const DESC_STATE_REQUIRED = new RegExp(
  String.raw`\b(must|required\s+to|need\s+to|candidates\s+must|applicants\s+must)\s+(\w+\s+){0,3}(reside|live|be\s+located|be\s+based)\s+(\w+\s+){0,3}(in|within)\s+(the\s+)?(state\s+of\s+)?(${STATE_NAME_RE.source.slice(3, -3)})\b` +
    String.raw`|\b(${STATE_NAME_RE.source.slice(3, -3)})\s+residents\s+only\b|\bresidents\s+of\s+(the\s+state\s+of\s+)?(${STATE_NAME_RE.source.slice(3, -3)})\s+only\b`,
  'i',
);

const DESC_STATE_LIST =
  /\b(open\s+to|hiring\s+in|residents\s+of|reside\s+in\s+one\s+of|located\s+in\s+one\s+of|currently\s+hiring\s+in|eligible\s+states?\s*(are|include)?|approved\s+states?)\s+(the\s+following\s+states|these\s+states|states)?\s*:?\s*([^.]{3,300})/i;

const DESC_EXCLUDED_STATES =
  /\b(unable|not\s+able|cannot|can't|can\s+not|do\s+not|does\s+not|are\s+not|is\s+not|not\s+currently)\s+(\w+\s+){0,3}(hire|hiring|consider|employ|accept|open)\s+(\w+\s+){0,5}(in|from|residing\s+in|located\s+in|who\s+(live|reside)\s+in|to)\s*:?\s*([^.]{2,250})|\b(excluding|except(\s+for)?|with\s+the\s+exception\s+of)\s+(the\s+(states?\s+of\s+)?)?([^.]{2,200})/i;

function formatStates(states: string[]): string {
  if (states.length <= 3) return states.join(', ');
  const abbr = Object.fromEntries(Object.entries(US_STATES).map(([a, n]) => [n, a]));
  return states.map((s) => abbr[s] ?? s).join(', ');
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Decides whether US-based workers can hold the job and describes the geographic scope.
 * Non-US locations are rejected unless the text explicitly opens the role to US applicants.
 */
export function classifyLocation(input: LocationInput): LocationClassification {
  const evidence: string[] = [];
  const locText = [input.location ?? '', ...(input.applicantLocations ?? [])].filter(Boolean).join(' | ');
  const title = input.title ?? '';
  const desc = input.description ?? '';

  const locStates = locText ? findUsStates(locText) : [];
  const locNonUs = locText ? findNonUsPlaces(locText) : [];
  // "Nationwide" / "US National" without any other country means the US.
  const usCountry = !!locText && (US_COUNTRY_RE.test(locText) || (/\bnation(wide|al)\b/i.test(locText) && locNonUs.length === 0));
  const includesUs = !!locText && INCLUDES_US_REGION_RE.test(locText);
  const titleNonUs = findNonUsPlaces(title);
  const titleStates = findUsStates(title);
  const titleUs = US_TOKEN_STRICT_RE.test(title);
  const locSaysRemote = /\b(remote|work\s+from\s+home|wfh|telecommute)\b/i.test(locText) || (titleStates.length > 0 && /\bremote\b/i.test(title));

  const descUsEligible = DESC_US_ELIGIBLE.test(desc);
  const descUsRequired = DESC_US_REQUIRED.test(desc);
  const descNonUs = desc.match(DESC_NON_US_REQUIRED);

  if (usCountry) evidence.push(`location mentions US: "${locText}"`);
  if (locStates.length) evidence.push(`location states: ${locStates.join(', ')}`);
  if (includesUs) evidence.push(`location is global/regional incl. US: "${locText}"`);
  if (descUsEligible) evidence.push('description opens role to US applicants');
  if (descUsRequired) evidence.push('description requires US residence');

  const hasUs = usCountry || locStates.length > 0 || titleStates.length > 0 || titleUs || descUsEligible || descUsRequired;
  const nonUs = unique([...locNonUs, ...titleNonUs]);

  const reject = (kind: LocationKind, reason: string): LocationClassification => ({
    us_eligible: false,
    kind,
    scope: null,
    states: [],
    excluded_states: [],
    evidence,
    reason,
  });

  if (descNonUs && !descUsEligible && !usCountry) {
    return reject('non_us', `description requires non-US residence: "${descNonUs[0].trim()}"`);
  }
  if (nonUs.length > 0 && !hasUs && !includesUs) {
    return reject('non_us', `location outside the US: ${nonUs.join(', ')}`);
  }
  if (input.countryHint === 'CA' && !usCountry && !descUsEligible && locStates.length === 0) {
    return reject('non_us', 'Canadian job board listing without US eligibility');
  }

  // --- State restrictions / exclusions from the description ---
  const restricted = new Set<string>();
  const stateReq = desc.match(DESC_STATE_REQUIRED);
  if (stateReq) for (const s of findUsStates(stateReq[0])) restricted.add(s);
  const stateList = desc.match(DESC_STATE_LIST);
  if (stateList) {
    const listed = findUsStates(stateList[stateList.length - 1] ?? '');
    if (listed.length >= 1) for (const s of listed) restricted.add(s);
  }
  const excluded = new Set<string>();
  const excl = desc.match(DESC_EXCLUDED_STATES);
  if (excl) {
    const captured = excl[7] ?? excl[12] ?? '';
    const context = excl[0];
    if (/\bstates?\b|\bresid|\blive|\blocated/i.test(context) || findUsStates(captured).length >= 2) {
      for (const s of findUsStates(captured)) excluded.add(s);
    }
  }
  for (const s of excluded) restricted.delete(s);

  const allLocStates = unique([...locStates, ...titleStates]);

  if (nonUs.length > 0) {
    // Mixed list such as "USA, Canada" or "Remote - US or UK".
    return {
      us_eligible: true,
      kind: 'multi_country',
      scope: `US + other countries (${nonUs.join(', ')})`,
      states: [...restricted],
      excluded_states: [...excluded],
      evidence,
      reason: null,
    };
  }

  const exclusionSuffix = excluded.size ? ` (excluding ${formatStates([...excluded])})` : '';

  if (restricted.size > 0) {
    const states = [...restricted];
    return {
      us_eligible: true,
      kind: 'us_states',
      scope: states.length === 1 ? `US - ${states[0]} only` : `US - eligible states: ${formatStates(states)}`,
      states,
      excluded_states: [...excluded],
      evidence: [...evidence, 'description restricts eligible states'],
      reason: null,
    };
  }

  if (allLocStates.length > 0 && !descUsEligible) {
    // "Remote - Texas" is an explicit state restriction; a plain "Dallas, TX" is the listed office location.
    const explicit = locSaysRemote;
    const scope =
      allLocStates.length === 1
        ? explicit
          ? `US - ${allLocStates[0]} only`
          : `US - ${allLocStates[0]} (listed location)`
        : `US - ${formatStates(allLocStates)}${explicit ? '' : ' (listed locations)'}`;
    return { us_eligible: true, kind: 'us_states', scope: scope + exclusionSuffix, states: allLocStates, excluded_states: [...excluded], evidence, reason: null };
  }

  if (usCountry || descUsEligible || descUsRequired || titleUs) {
    return { us_eligible: true, kind: 'us_nationwide', scope: `US nationwide${exclusionSuffix}`, states: [], excluded_states: [...excluded], evidence, reason: null };
  }

  if (includesUs) {
    const region = /north\s+america/i.test(locText) ? 'North America' : /americas/i.test(locText) ? 'Americas' : 'Worldwide';
    return { us_eligible: true, kind: 'global', scope: `${region} (US eligible)${exclusionSuffix}`, states: [], excluded_states: [...excluded], evidence, reason: null };
  }

  if (input.countryHint === 'US') {
    evidence.push('platform search restricted to the United States');
    return { us_eligible: true, kind: 'us_unspecified', scope: `US (platform-filtered)${exclusionSuffix}`, states: [], excluded_states: [...excluded], evidence, reason: null };
  }

  if (US_TOKEN_STRICT_RE.test(desc) && /\b(remote|work\s+from\s+home)\b/i.test(desc) && !findNonUsPlaces(desc.slice(0, 3000)).length) {
    evidence.push('description references the US');
    return { us_eligible: true, kind: 'us_unspecified', scope: `US (from description)${exclusionSuffix}`, states: [], excluded_states: [...excluded], evidence, reason: null };
  }

  return reject('unknown', locText ? `location not confirmed as US: "${locText}"` : 'no location information to confirm US eligibility');
}
