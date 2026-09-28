import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NormalizedJob, SourceId } from '../models/job.ts';
import { jobsToCsv } from '../output/csv.ts';
import type { AppContext } from '../services/context.ts';
import { runSearch } from '../services/searchService.ts';
import { listSources, probeSources } from '../services/sourceStatus.ts';
import { resolveSourceId } from '../sources/registry.ts';
import { ValidationError, parseSearchRequest } from './schemas.ts';

const FormatQuery = z.object({ format: z.enum(['json', 'csv']).optional().default('json') }).passthrough();

class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Searches are expensive and hit third-party sites, so they run one at a time;
 * a small queue absorbs bursts and anything beyond it gets HTTP 429.
 */
function createSearchQueue(maxWaiting: number) {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      if (pending > maxWaiting) throw new HttpError(429, 'a search is already running; try again when it finishes');
      pending++;
      const next = tail.then(fn, fn);
      tail = next.catch(() => {}).finally(() => pending--);
      return next;
    },
  };
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const log = ctx.logger.child('API');
  const queue = createSearchQueue(2);

  app.addHook('onResponse', async (request, reply) => {
    log.info(`${request.method} ${request.url.split('?')[0]} ${reply.statusCode}`, { ms: Math.round(reply.elapsedTime) });
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ValidationError) return reply.status(400).send({ error: 'validation_error', details: error.details });
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'validation_error', details: error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`) });
    }
    if (error instanceof HttpError) return reply.status(error.statusCode).send({ error: error.message });
    const e = error as { statusCode?: number; message?: string; validation?: unknown };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: e.message ?? 'bad request' });
    }
    // Log the details server-side; never leak stack traces to clients.
    log.error('unhandled error', { error: e.message, stack: ctx.config.isProduction ? undefined : (error as Error).stack?.split('\n').slice(0, 4).join(' | ') });
    return reply.status(500).send({ error: 'internal_error' });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: 'not_found' }));

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/sources', async () => listSources(ctx));

  app.get('/api/health/sources', async (request) => {
    const q = z.object({ probe: z.enum(['true', 'false', '1', '0']).optional(), sources: z.string().max(300).optional() }).parse(request.query);
    const sources = listSources(ctx);
    if (q.probe !== 'true' && q.probe !== '1') return { checked_at: new Date().toISOString(), probed: false, sources };
    let ids: SourceId[] | undefined;
    if (q.sources) {
      ids = q.sources.split(',').map((s) => resolveSourceId(s)).filter((s): s is SourceId => !!s);
      if (!ids.length) throw new HttpError(400, 'no valid source ids given');
    }
    return { checked_at: new Date().toISOString(), probed: true, probes: await probeSources(ctx, ids), sources };
  });

  app.post('/api/jobs/search', async (request, reply) => {
    const { format } = FormatQuery.parse(request.query ?? {});
    const req = parseSearchRequest(request.body ?? {}, ctx.config);

    // Abort the run if the client disconnects before we answer.
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort(new Error('client disconnected'));
    });

    const result = await queue.run(() => runSearch(ctx, req, { signal: controller.signal }));
    reply.header('x-run-id', result.run_id);
    reply.header('x-jobs-count', String(result.jobs.length));
    reply.header('x-sources-succeeded', String(result.summary.sources_succeeded));
    reply.header('x-sources-failed', String(result.summary.sources_failed));

    if (format === 'csv') {
      const filename = `medical_remote_jobs_${new Date().toISOString().slice(0, 10)}.csv`;
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(jobsToCsv(result.jobs, { bom: ctx.config.csvBom }));
    }
    return reply.header('content-type', 'application/json; charset=utf-8').send(result);
  });

  app.get('/api/runs', async (request) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    if (!ctx.repo) throw new HttpError(404, 'persistence is disabled');
    return ctx.repo.listRuns(q.limit ?? 20);
  });

  app.get('/api/runs/:id', async (request) => {
    const { id } = z.object({ id: z.string().regex(/^run_[\w]+$/).max(60) }).parse(request.params);
    if (!ctx.repo) throw new HttpError(404, 'persistence is disabled');
    const run = ctx.repo.getRun(id);
    if (!run) throw new HttpError(404, 'run not found');
    return run;
  });

  app.get('/api/jobs', async (request, reply) => {
    const q = z
      .object({
        hours: z.coerce.number().int().min(1).max(24 * 90).optional(),
        limit: z.coerce.number().int().min(1).max(2_000).optional(),
        format: z.enum(['json', 'csv']).optional(),
      })
      .parse(request.query);
    if (!ctx.repo) throw new HttpError(404, 'persistence is disabled');
    const jobs = ctx.repo.listJobs({ seenWithinHours: q.hours ?? 72, limit: q.limit ?? 500 });
    if (q.format === 'csv') {
      return reply.header('content-type', 'text/csv; charset=utf-8').send(jobsToCsv(jobs as unknown as NormalizedJob[], { bom: ctx.config.csvBom }));
    }
    return { count: jobs.length, jobs };
  });

  return app;
}
