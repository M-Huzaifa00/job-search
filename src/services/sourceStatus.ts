import { SourceHttp } from '../http/client.ts';
import { toSourceError } from '../http/errors.ts';
import type { SourceId } from '../models/job.ts';
import { allAdapters, defaultSourceIds, getAdapter } from '../sources/registry.ts';
import type { ProbeResult } from '../sources/types.ts';
import { mapPool } from '../utils/concurrency.ts';
import type { AppContext } from './context.ts';

export interface SourceInfo {
  id: SourceId;
  source: string;
  enabled: boolean;
  status: string;
  method: string;
  method_detail: string;
  configured: boolean;
  unavailable_reason: string | null;
  notes: string;
  requirement: string | null;
  homepage: string;
  last_run: { status: string; finished_at: string; raw: number; accepted: number; error: string | null } | null;
}

export function listSources(app: AppContext): SourceInfo[] {
  const enabled = new Set(defaultSourceIds(app.config));
  const last = app.repo?.lastSourceStatuses() ?? new Map();
  return allAdapters().map((a) => {
    const unavailable = a.unavailableReason?.(app.config) ?? null;
    const l = last.get(a.meta.id);
    let lastError: string | null = null;
    if (l?.errors) {
      try {
        lastError = (JSON.parse(l.errors) as { message: string }[])[0]?.message ?? null;
      } catch {
        lastError = null;
      }
    }
    return {
      id: a.meta.id,
      source: a.meta.name,
      enabled: enabled.has(a.meta.id) && !unavailable,
      status: a.meta.status,
      method: a.meta.method,
      method_detail: a.meta.methodDetail,
      configured: !unavailable,
      unavailable_reason: unavailable?.message ?? null,
      notes: a.meta.notes,
      requirement: a.meta.requirement ?? null,
      homepage: a.meta.homepage,
      last_run: l ? { status: l.status, finished_at: l.finished_at, raw: l.raw_count, accepted: l.accepted_count, error: lastError } : null,
    };
  });
}

export interface ProbeReport extends ProbeResult {
  id: SourceId;
  source: string;
  status: string;
  checked_at: string;
  duration_ms: number;
}

const PROBE_TTL_MS = 10 * 60_000;
const probeCache = new Map<SourceId, { at: number; report: ProbeReport }>();

/** Live reachability check: one lightweight request per source, cached for 10 minutes. */
export async function probeSources(app: AppContext, ids?: SourceId[]): Promise<ProbeReport[]> {
  const targets = ids?.length ? ids : allAdapters().map((a) => a.meta.id);
  return mapPool(targets, 4, async (id) => {
    const cached = probeCache.get(id);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.report;
    const adapter = getAdapter(id);
    const started = Date.now();
    let result: ProbeResult;
    const unavailable = adapter.unavailableReason?.(app.config) ?? null;
    if (unavailable && unavailable.category !== 'BLOCKED') {
      result = { ok: false, category: unavailable.category, message: unavailable.message };
    } else if (!adapter.probe) {
      result = { ok: false, category: 'UNSUPPORTED', message: 'no probe implemented' };
    } else {
      try {
        result = await adapter.probe({ http: new SourceHttp(app.http), log: app.logger.child(adapter.meta.name), signal: AbortSignal.timeout(60_000), config: app.config });
      } catch (err) {
        const e = toSourceError(err);
        result = { ok: false, category: e.category, message: e.message, httpStatus: e.status };
      }
    }
    const report: ProbeReport = {
      id,
      source: adapter.meta.name,
      status: result.ok ? 'working' : unavailable?.category === 'BLOCKED' || result.category === 'BLOCKED' ? 'blocked' : 'failing',
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      ...result,
    };
    probeCache.set(id, { at: Date.now(), report });
    return report;
  });
}
