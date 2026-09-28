export const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  PR: 'Puerto Rico',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const STATE_NAMES = Object.values(US_STATES).sort((a, b) => b.length - a.length);
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]));

/** Matches a full US state name as a whole phrase (case-insensitive). */
export const STATE_NAME_RE = new RegExp(`\\b(${STATE_NAMES.map((n) => n.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');

/** Matches "City, ST" or "- ST" / "(ST)" style abbreviations (case-sensitive, must be uppercase). */
export const STATE_ABBR_RE = new RegExp(`(?:,|\\s[-–|]|\\(|^|\\bRemote\\s*[-–,:]?)\\s*(${Object.keys(US_STATES).join('|')})\\b(?!\\s*[a-z])`, 'g');

export function stateNameFromAny(value: string): string | null {
  const v = value.trim();
  if (US_STATES[v.toUpperCase()] && v.length === 2) return US_STATES[v.toUpperCase()];
  return STATE_BY_NAME.has(v.toLowerCase().replace(/\s+/g, ' ')) ? US_STATES[STATE_BY_NAME.get(v.toLowerCase().replace(/\s+/g, ' '))!] : null;
}

/** Returns the distinct US states mentioned in a location-like string. */
export function findUsStates(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(STATE_NAME_RE)) {
    const name = stateNameFromAny(m[1].replace(/\s+/g, ' '));
    if (name) found.add(name);
  }
  // "Washington, DC" / "Washington, D.C." is the district, not the state.
  if (found.has('Washington') && /washington,?\s*d\.?\s*c\b/i.test(text)) found.delete('Washington');
  for (const m of text.matchAll(STATE_ABBR_RE)) found.add(US_STATES[m[1]]);
  return [...found];
}

/** US country mention inside a location field (where a lowercase "us" is not a pronoun). */
export const US_COUNTRY_RE = /\b(united\s+states(\s+of\s+america)?|u\.\s?s\.\s?a\.?|usa)\b|\bu\.\s?s\.(?!\w)|(^|[\s,(/-])us($|[\s,)/-])/i;
/** Regions that include the US without naming it. */
export const INCLUDES_US_REGION_RE = /\b(north\s+america|the\s+americas|americas|worldwide|world\s*wide|global(ly)?|anywhere(?!\s+in\b)|international|any\s+location|all\s+countries)\b/i;
/** Case-sensitive "US" token check for free text, where lowercase "us" is a pronoun. */
export const US_TOKEN_STRICT_RE = /\b(United\s+States(\s+of\s+America)?|U\.\s?S\.\s?A\.?|U\.S\.|USA)\b|(^|[\s,(/-])US(?=$|[\s,)/.-])/;

export const CANADIAN_PROVINCES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

/** Non-US countries / regions. Matched as whole words, case-insensitive. */
const NON_US_REGIONS = [
  'canada',
  'canadian',
  'united kingdom',
  'uk',
  'u\\.k\\.',
  'great britain',
  'england',
  'scotland',
  'wales',
  'northern ireland',
  'ireland',
  'europe',
  'european union',
  'eu',
  'emea',
  'apac',
  'asia',
  'asia pacific',
  'latam',
  'latin america',
  'south america',
  'central america',
  'africa',
  'middle east',
  'mena',
  'oceania',
  'india',
  'philippines',
  'pakistan',
  'bangladesh',
  'sri lanka',
  'nepal',
  'mexico',
  'brazil',
  'argentina',
  'colombia',
  'chile',
  'peru',
  'costa rica',
  'guatemala',
  'honduras',
  'el salvador',
  'dominican republic',
  'jamaica',
  'germany',
  'france',
  'spain',
  'portugal',
  'italy',
  'netherlands',
  'belgium',
  'switzerland',
  'austria',
  'poland',
  'romania',
  'bulgaria',
  'ukraine',
  'serbia',
  'croatia',
  'greece',
  'turkey',
  'türkiye',
  'sweden',
  'norway',
  'denmark',
  'finland',
  'estonia',
  'latvia',
  'lithuania',
  'czech republic',
  'czechia',
  'hungary',
  'slovakia',
  'israel',
  'egypt',
  'nigeria',
  'kenya',
  'south africa',
  'ghana',
  'morocco',
  'uae',
  'united arab emirates',
  'saudi arabia',
  'qatar',
  'australia',
  'new zealand',
  'singapore',
  'malaysia',
  'indonesia',
  'vietnam',
  'thailand',
  'japan',
  'china',
  'hong kong',
  'taiwan',
  'south korea',
  'korea',
];

/** Cities that are unambiguously outside the US (no well-known US namesake). */
const NON_US_CITIES = [
  'toronto',
  'vancouver',
  'montreal',
  'montréal',
  'calgary',
  'edmonton',
  'ottawa',
  'winnipeg',
  'mississauga',
  'brampton',
  'markham',
  'halifax',
  'quebec city',
  'saskatoon',
  'regina',
  'bangalore',
  'bengaluru',
  'hyderabad',
  'mumbai',
  'pune',
  'chennai',
  'new delhi',
  'delhi',
  'noida',
  'gurgaon',
  'gurugram',
  'kolkata',
  'ahmedabad',
  'manila',
  'cebu',
  'makati',
  'quezon city',
  'davao',
  'karachi',
  'lahore',
  'islamabad',
  'rawalpindi',
  'dhaka',
  'mexico city',
  'guadalajara',
  'monterrey',
  'bogota',
  'bogotá',
  'medellin',
  'medellín',
  'sao paulo',
  'são paulo',
  'buenos aires',
  'london, uk',
  'london, england',
  'dublin, ireland',
  'berlin',
  'munich',
  'amsterdam',
  'madrid',
  'barcelona',
  'lisbon',
  'warsaw',
  'krakow',
  'bucharest',
  'sofia',
  'kyiv',
  'sydney',
  'melbourne',
  'auckland',
  'dubai',
  'tel aviv',
  'lagos',
  'nairobi',
  'cape town',
  'johannesburg',
];

export const NON_US_RE = new RegExp(`\\b(${[...NON_US_REGIONS, ...NON_US_CITIES].map((s) => s.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');

/** Canadian province abbreviations in the forms job boards use: "Markham (ON)", "Toronto, ON". */
export const CA_PROVINCE_ABBR_RE = new RegExp(`(?:\\(|,\\s*)(${Object.keys(CANADIAN_PROVINCES).join('|')})\\)?(?=$|[\\s,)])`, 'g');
export const CA_PROVINCE_NAME_RE = new RegExp(
  `\\b(${Object.values(CANADIAN_PROVINCES)
    .map((n) => n.replace(/ /g, '\\s+'))
    .join('|')})\\b`,
  'gi',
);

export function findNonUsPlaces(text: string): string[] {
  // US names that contain a non-US word ("New Mexico", "New England").
  const cleaned = text.replace(/\bnew\s+(mexico|england)\b/gi, ' ').replace(/\b(north\s+america|the\s+americas)\b/gi, ' ');
  const found = new Set<string>();
  for (const m of cleaned.matchAll(NON_US_RE)) {
    const v = m[1].toLowerCase().replace(/\s+/g, ' ');
    // "EU" / "UK" must be uppercase to avoid matching ordinary words.
    if ((v === 'eu' || v === 'uk') && m[1] !== m[1].toUpperCase()) continue;
    found.add(v);
  }
  for (const m of cleaned.matchAll(CA_PROVINCE_NAME_RE)) found.add(m[1].toLowerCase().replace(/\s+/g, ' '));
  // Canadian and US postal abbreviations never overlap, so "(ON)" / ", BC" is unambiguous.
  for (const m of cleaned.matchAll(CA_PROVINCE_ABBR_RE)) found.add(CANADIAN_PROVINCES[m[1]].toLowerCase());
  return [...found];
}
