import type { AppConfig } from '../config/env.ts';
import { SOURCE_IDS, type SourceId } from '../models/job.ts';
import { builtin, careerbuilder, flexjobs, glassdoor, indeed, monster, wellfound, ziprecruiter } from './blocked.ts';
import { canadaJobBank } from './canadaJobBank/index.ts';
import { careerjet } from './careerjet/index.ts';
import { dice } from './dice/index.ts';
import { himalayas } from './himalayas/index.ts';
import { jobicy } from './jobicy/index.ts';
import { jobright } from './jobright/index.ts';
import { jooble } from './jooble/index.ts';
import { linkedin } from './linkedin/index.ts';
import { remoteok } from './remoteok/index.ts';
import { remotive } from './remotive/index.ts';
import { simplyhired } from './simplyhired/index.ts';
import { weworkremotely } from './weworkremotely/index.ts';
import type { SourceAdapter } from './types.ts';

export const ADAPTERS: Record<SourceId, SourceAdapter> = {
  linkedin,
  ziprecruiter,
  glassdoor,
  simplyhired,
  careerbuilder,
  monster,
  dice,
  wellfound,
  remoteok,
  remotive,
  jobicy,
  jooble,
  canada_job_bank: canadaJobBank,
  careerjet,
  jobright,
  himalayas,
  weworkremotely,
  builtin,
  flexjobs,
  indeed,
};

export function getAdapter(id: SourceId): SourceAdapter {
  return ADAPTERS[id];
}

export function allAdapters(): SourceAdapter[] {
  return SOURCE_IDS.map((id) => ADAPTERS[id]);
}

export function sourceName(id: SourceId): string {
  return ADAPTERS[id]?.meta.name ?? id;
}

/** The sources a run uses when the request does not name any. */
export function defaultSourceIds(config: AppConfig): SourceId[] {
  const base = config.enabledSources ?? SOURCE_IDS.filter((id) => ADAPTERS[id].meta.defaultEnabled);
  return base.filter((id) => !config.disabledSources.includes(id));
}

/** Accepts ids and display names ("canada_job_bank", "Canada Job Bank", "canadaJobBank"). */
export function resolveSourceId(value: string): SourceId | null {
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((SOURCE_IDS as readonly string[]).includes(v)) return v as SourceId;
  const compact = v.replace(/_/g, '');
  for (const id of SOURCE_IDS) {
    if (id.replace(/_/g, '') === compact || ADAPTERS[id].meta.name.toLowerCase().replace(/[\s_-]+/g, '') === compact) return id;
  }
  return null;
}
