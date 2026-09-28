import type { RawJob, RemoteHint, SalaryPeriod } from '../../models/job.ts';
import { periodFromCode } from '../../core/normalization/salary.ts';
import { decodeEntities } from '../../utils/text.ts';

type Json = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

function isJobPosting(o: unknown): o is Json {
  if (!o || typeof o !== 'object') return false;
  const t = (o as Json)['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

/** Finds the first schema.org JobPosting in the page's JSON-LD blocks. */
export function extractJobPostingJsonLd(html: string): Json | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      try {
        // Some sites leave raw control characters in the JSON.
        data = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' '));
      } catch {
        continue;
      }
    }
    const candidates = asArray(data as Json | Json[]).flatMap((d) => [d, ...asArray((d as Json)?.['@graph'] as Json[])]);
    const found = candidates.find(isJobPosting);
    if (found) return found;
  }
  return null;
}

function placeToString(place: unknown): string | null {
  if (!place || typeof place !== 'object') return str(place);
  const p = place as Json;
  const addr = (p.address ?? p) as Json;
  if (typeof addr === 'string') return addr;
  const country = typeof addr.addressCountry === 'object' ? str((addr.addressCountry as Json)?.name) : str(addr.addressCountry);
  const parts = [str(addr.addressLocality), str(addr.addressRegion), country].filter(Boolean);
  return parts.length ? parts.join(', ') : str(p.name);
}

function salaryFrom(ld: Json): { min: number | null; max: number | null; currency: string | null; period: SalaryPeriod | null } | null {
  const base = ld.baseSalary as Json | undefined;
  if (!base || typeof base !== 'object') return null;
  const currency = str(base.currency);
  const value = base.value as Json | number | undefined;
  let min: number | null = null;
  let max: number | null = null;
  let unit: string | null = null;
  if (typeof value === 'number') {
    min = max = value;
  } else if (value && typeof value === 'object') {
    const v = Number(value.value);
    min = Number.isFinite(Number(value.minValue)) ? Number(value.minValue) : Number.isFinite(v) ? v : null;
    max = Number.isFinite(Number(value.maxValue)) ? Number(value.maxValue) : Number.isFinite(v) ? v : null;
    unit = str(value.unitText);
  }
  unit ??= str(base.unitText);
  if (min === null && max === null) return null;
  return { min, max, currency, period: periodFromCode(unit) };
}

/** Maps a schema.org JobPosting into RawJob fields. */
export function jobPostingToRaw(ld: Json): Partial<RawJob> {
  const org = ld.hiringOrganization as Json | string | undefined;
  const company = typeof org === 'string' ? org : str(org?.name);
  const locations = asArray(ld.jobLocation as Json | Json[]).map(placeToString).filter((s): s is string => !!s);
  const applicant = asArray(ld.applicantLocationRequirements as Json | Json[])
    .map((a) => (typeof a === 'string' ? a : str(a?.name)))
    .filter((s): s is string => !!s);
  const locType = asArray(ld.jobLocationType as string | string[]).join(' ');
  const hints: RemoteHint[] = [];
  if (/telecommute/i.test(locType)) hints.push({ kind: 'structured_remote', detail: 'schema.org jobLocationType=TELECOMMUTE' });
  const employment = asArray(ld.employmentType as string | string[]).join(', ');
  const description = str(ld.description);
  return {
    title: str(ld.title) ? decodeEntities(str(ld.title)!) : undefined,
    company: company ? decodeEntities(company) : undefined,
    location: locations.length ? locations.join(' | ') : undefined,
    applicantLocations: applicant.length ? applicant : undefined,
    descriptionHtml: description ? (/[<&]/.test(description) ? decodeEntities(description) : description) : undefined,
    employmentType: employment || undefined,
    postedAt: str(ld.datePosted) ?? undefined,
    salary: salaryFrom(ld) ?? undefined,
    remoteHints: hints,
    applyUrl: str(ld.url) ?? undefined,
  };
}
