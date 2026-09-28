import { z } from 'zod';
import type { AppConfig } from '../config/env.ts';
import { DEFAULT_TITLES } from '../config/keywords.ts';
import type { SourceId } from '../models/job.ts';
import type { SearchRequest } from '../models/search.ts';
import { resolveSourceId } from '../sources/registry.ts';

export const LIMITS = {
  maxTitles: 50,
  maxTitleLength: 100,
  maxHoursOld: 720,
  maxPages: 10,
  maxResultsPerSource: 2_000,
  maxResultsPerKeyword: 500,
};

const TITLE_RE = /^[\p{L}\p{N} &/+.,'()#-]+$/u;
const US_RE = /^(us|u\.s\.?|usa|u\.s\.a\.?|united states|united states of america)$/i;

export const SearchBodySchema = z
  .object({
    titles: z
      .array(
        z
          .string()
          .trim()
          .min(2, 'each title must have at least 2 characters')
          .max(LIMITS.maxTitleLength, `each title must be at most ${LIMITS.maxTitleLength} characters`)
          .regex(TITLE_RE, 'titles may only contain letters, numbers, spaces and & / + . , \' ( ) # -'),
      )
      .min(1)
      .max(LIMITS.maxTitles)
      .optional(),
    country: z
      .string()
      .trim()
      .optional()
      .refine((c) => c === undefined || US_RE.test(c), { message: 'only the United States is supported (use "USA")' }),
    remoteOnly: z.boolean().optional(),
    hoursOld: z.number().int().min(1).max(LIMITS.maxHoursOld).optional(),
    sources: z.array(z.string().trim().min(2).max(40)).min(1).max(20).optional(),
    maxPagesPerKeyword: z.number().int().min(1).max(LIMITS.maxPages).optional(),
    maxResultsPerSource: z.number().int().min(1).max(LIMITS.maxResultsPerSource).optional(),
    maxResultsPerKeyword: z.number().int().min(1).max(LIMITS.maxResultsPerKeyword).optional(),
    includeDuplicates: z.boolean().optional(),
    includeRejected: z.boolean().optional(),
    includeUndated: z.boolean().optional(),
    fetchDetails: z.boolean().optional(),
  })
  .strict();

export type SearchBody = z.infer<typeof SearchBodySchema>;

export class ValidationError extends Error {
  readonly details: string[];
  constructor(details: string[]) {
    super(`invalid request: ${details.join('; ')}`);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/** Validates untrusted input (API body or CLI flags) and fills defaults. */
export function parseSearchRequest(input: unknown, config: AppConfig): SearchRequest {
  const parsed = SearchBodySchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`));
  }
  const b = parsed.data;
  let sources: SourceId[] | undefined;
  if (b.sources) {
    const unknown: string[] = [];
    sources = [];
    for (const s of b.sources) {
      const id = resolveSourceId(s);
      if (!id) unknown.push(s);
      else if (!sources.includes(id)) sources.push(id);
    }
    if (b.sources.some((v) => /indeed/i.test(v))) throw new ValidationError(['sources: Indeed is excluded from this aggregator']);
    if (unknown.length) throw new ValidationError([`sources: unknown source(s): ${unknown.join(', ')}`]);
  }
  return {
    titles: b.titles ?? DEFAULT_TITLES,
    country: 'US',
    remoteOnly: b.remoteOnly ?? true,
    hoursOld: b.hoursOld ?? config.defaultHoursOld,
    sources,
    maxPagesPerKeyword: b.maxPagesPerKeyword,
    maxResultsPerSource: b.maxResultsPerSource,
    maxResultsPerKeyword: b.maxResultsPerKeyword,
    includeDuplicates: b.includeDuplicates ?? false,
    includeRejected: b.includeRejected ?? false,
    includeUndated: b.includeUndated,
    fetchDetails: b.fetchDetails,
  };
}
