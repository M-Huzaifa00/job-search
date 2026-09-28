import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/app.ts';
import { parseSearchRequest } from '../src/api/schemas.ts';
import { buildConfig } from '../src/config/env.ts';
import { DEFAULT_TITLES } from '../src/config/keywords.ts';
import { createAppContext, type AppContext } from '../src/services/context.ts';
import { silentLogger } from '../src/utils/logger.ts';

const config = buildConfig({ PERSIST: 'false' });

describe('request validation', () => {
  it('fills defaults: all 20 titles, US, remote only, 24h', () => {
    const r = parseSearchRequest({}, config);
    assert.deepEqual(r.titles, DEFAULT_TITLES);
    assert.equal(r.country, 'US');
    assert.equal(r.remoteOnly, true);
    assert.equal(r.hoursOld, 24);
  });

  it('accepts the documented body and source names', () => {
    const r = parseSearchRequest({ titles: ['medical billing'], country: 'USA', remoteOnly: true, hoursOld: 48, sources: ['LinkedIn', 'canada_job_bank', 'remoteok'] }, config);
    assert.deepEqual(r.sources, ['linkedin', 'canada_job_bank', 'remoteok']);
    assert.equal(r.hoursOld, 48);
  });

  it('rejects bad input', () => {
    assert.throws(() => parseSearchRequest({ country: 'Canada' }, config), /United States/);
    assert.throws(() => parseSearchRequest({ sources: ['indeed'] }, config), /Indeed is excluded/);
    assert.throws(() => parseSearchRequest({ sources: ['myspace'] }, config), /unknown source/);
    assert.throws(() => parseSearchRequest({ titles: ['x'.repeat(101)] }, config), /at most 100/);
    assert.throws(() => parseSearchRequest({ titles: Array(51).fill('medical billing') }, config));
    assert.throws(() => parseSearchRequest({ titles: ['<script>alert(1)</script>'] }, config));
    assert.throws(() => parseSearchRequest({ hoursOld: 0 }, config));
    assert.throws(() => parseSearchRequest({ url: 'http://169.254.169.254/' }, config), /Unrecognized|unrecognized/);
  });
});

describe('HTTP API', () => {
  let app: FastifyInstance;
  let ctx: AppContext;

  before(async () => {
    ctx = createAppContext(config, { logger: silentLogger, persist: false });
    app = await buildApp(ctx);
  });
  after(async () => {
    await app.close();
    await ctx.close();
  });

  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });

  it('GET /api/sources lists all 15 sources with status and method', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    const body = res.json() as { id: string; status: string; method: string; enabled: boolean }[];
    assert.equal(body.length, 15);
    const byId = Object.fromEntries(body.map((s) => [s.id, s]));
    assert.equal(byId.linkedin.status, 'working');
    assert.equal(byId.remoteok.method, 'api');
    assert.equal(byId.glassdoor.status, 'blocked');
    assert.equal(byId.glassdoor.enabled, false);
    assert.equal(byId.simplyhired.enabled, false);
    assert.ok(!body.some((s) => /indeed/i.test(s.id)));
  });

  it('POST /api/jobs/search validates input and never exposes stack traces', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/jobs/search', payload: { country: 'UK' } });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string; details: string[] };
    assert.equal(body.error, 'validation_error');
    assert.ok(!JSON.stringify(body).includes('at '));
  });

  it('rejects an invalid format parameter', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/jobs/search?format=xml', payload: {} });
    assert.equal(res.statusCode, 400);
  });

  it('unknown routes return 404 JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    assert.equal(res.statusCode, 404);
  });
});
