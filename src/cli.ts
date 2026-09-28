import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { ValidationError, parseSearchRequest } from './api/schemas.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import type { SourceId } from './models/job.ts';
import { jobsToCsv } from './output/csv.ts';
import { resultToJson } from './output/json.ts';
import { buildPortalLinks, portalLinksToCsv, portalLinksToHtml } from './output/portalLinks.ts';
import { createAppContext } from './services/context.ts';
import { runSearch } from './services/searchService.ts';
import { listSources, probeSources } from './services/sourceStatus.ts';
import { allAdapters, resolveSourceId } from './sources/registry.ts';
import { createLogger } from './utils/logger.ts';

const int = (name: string) => (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError(`${name} must be an integer`);
  return n;
};
const list = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function withLogLevel(config: AppConfig, level?: string): AppConfig {
  return level ? { ...config, logLevel: level as AppConfig['logLevel'] } : config;
}

function readTitlesFile(path: string): string[] {
  return readFileSync(resolve(path), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function writeFile(path: string, body: string): string {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
  return full;
}

/** HTML page of clickable links, or CSV when the file name ends in .csv. */
function writePortalLinks(path: string, titles: string[], q: { hoursOld: number; remoteOnly: boolean }, config: AppConfig): { path: string; count: number } {
  // Only portals this configuration can't collect from (blocked, or off by policy).
  const set = buildPortalLinks(titles, q, allAdapters().filter((a) => a.unavailableReason?.(config)));
  const bom = config.csvBom;
  const body = path.toLowerCase().endsWith('.csv') ? portalLinksToCsv(set, { bom }) : portalLinksToHtml(set);
  return { path: writeFile(path, body), count: set.rows.length * set.portals.length };
}

const program = new Command();
program.name('job-scraper').description('Aggregates current, fully-remote, US-eligible healthcare administration jobs.');

program
  .command('search')
  .description('run a search across the enabled sources and write CSV or JSON')
  .option('--titles <list>', 'comma-separated job titles / search terms (default: the 20 built-in healthcare terms)', list)
  .option('--titles-file <path>', 'file with one search term per line')
  .option('--sources <list>', 'comma-separated source ids (default: all enabled sources)', list)
  .option('--country <country>', 'only USA is supported', 'USA')
  .option('--remote-only', 'only fully remote jobs (default)', true)
  .option('--no-remote-only', 'also return hybrid/onsite jobs')
  .option('--hours-old <n>', 'maximum posting age in hours (24, 48, 72, ...)', int('hours-old'))
  .addOption(new Option('--format <format>', 'output format').choices(['csv', 'json']).default('csv'))
  .option('--output <file>', 'write to this file instead of stdout')
  .option('--max-pages <n>', 'max result pages per keyword per source', int('max-pages'))
  .option('--max-results-per-source <n>', 'cap on listings collected per source', int('max-results-per-source'))
  .option('--max-results-per-keyword <n>', 'cap on listings collected per keyword', int('max-results-per-keyword'))
  .option('--include-duplicates', 'also output the merged duplicate listings (flagged is_duplicate=true)')
  .option('--include-rejected', 'JSON only: include rejected listings with their rejection reason')
  .option('--include-undated', 'keep listings without a posting date')
  .option('--no-details', 'skip job-detail page fetching (faster, less accurate)')
  .option('--no-persist', 'do not write to the SQLite database')
  .option('--portal-links <file>', 'also write search links for the portals that block scraping (.html page, or .csv)')
  .addOption(new Option('--log-level <level>', 'log verbosity').choices(['debug', 'info', 'warn', 'error']))
  .action(async (opts) => {
    const config = withLogLevel(loadConfig(), opts.logLevel);
    let titles: string[] | undefined = opts.titles;
    if (opts.titlesFile) titles = readTitlesFile(opts.titlesFile);
    const req = parseSearchRequest(
      {
        titles,
        country: opts.country,
        remoteOnly: opts.remoteOnly,
        hoursOld: opts.hoursOld,
        sources: opts.sources,
        maxPagesPerKeyword: opts.maxPages,
        maxResultsPerSource: opts.maxResultsPerSource,
        maxResultsPerKeyword: opts.maxResultsPerKeyword,
        includeDuplicates: opts.includeDuplicates ?? false,
        includeRejected: opts.includeRejected ?? false,
        includeUndated: opts.includeUndated,
        fetchDetails: opts.details,
      },
      config,
    );
    const ctx = createAppContext(config, { persist: opts.persist !== false && config.persist });
    const controller = new AbortController();
    process.once('SIGINT', () => {
      ctx.logger.warn('interrupted: finishing with partial results (press Ctrl+C again to force quit)');
      controller.abort(new Error('interrupted'));
      process.once('SIGINT', () => process.exit(130));
    });
    try {
      const result = await runSearch(ctx, req, { signal: controller.signal });
      const body = opts.format === 'json' ? resultToJson(result) : jobsToCsv(result.jobs, { bom: config.csvBom && !!opts.output });
      if (opts.output) {
        const path = writeFile(opts.output, body);
        ctx.logger.info(`wrote ${result.jobs.length} jobs to ${path}`);
      } else {
        process.stdout.write(body);
      }
      if (opts.portalLinks) {
        const links = writePortalLinks(opts.portalLinks, req.titles, { hoursOld: req.hoursOld, remoteOnly: req.remoteOnly }, config);
        ctx.logger.info(`wrote ${links.count} portal search links to ${links.path}`);
      }
    } finally {
      await ctx.close();
    }
  });

program
  .command('links')
  .description('write search links for the portals that block scraping, to open in your own browser (instant, no requests)')
  .option('--titles <list>', 'comma-separated job titles / search terms (default: the 20 built-in healthcare terms)', list)
  .option('--titles-file <path>', 'file with one search term per line')
  .option('--hours-old <n>', 'maximum posting age in hours', int('hours-old'))
  .option('--no-remote-only', 'do not restrict the links to remote jobs')
  .option('--output <file>', 'where to write the links (.html page, or .csv)', 'output/portal_links.html')
  .action((opts) => {
    const config = loadConfig();
    const req = parseSearchRequest({ titles: opts.titlesFile ? readTitlesFile(opts.titlesFile) : opts.titles, hoursOld: opts.hoursOld, remoteOnly: opts.remoteOnly }, config);
    const links = writePortalLinks(opts.output, req.titles, { hoursOld: req.hoursOld, remoteOnly: req.remoteOnly }, config);
    createLogger({ level: 'info' }).info(`wrote ${links.count} portal search links to ${links.path}`);
  });

program
  .command('sources')
  .description('list sources, their access method and status')
  .option('--json', 'print JSON')
  .action(async (opts) => {
    const ctx = createAppContext(loadConfig());
    try {
      const sources = listSources(ctx);
      if (opts.json) {
        process.stdout.write(JSON.stringify(sources, null, 2) + '\n');
        return;
      }
      const rows = sources.map((s) => [s.source, s.enabled ? 'yes' : 'no', s.status, s.method, s.last_run ? `${s.last_run.status} (${s.last_run.accepted}/${s.last_run.raw})` : '-', s.unavailable_reason ?? '']);
      const header = ['SOURCE', 'ENABLED', 'STATUS', 'METHOD', 'LAST RUN (acc/raw)', 'NOTE'];
      const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
      const fmt = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
      process.stdout.write([fmt(header), ...rows.map(fmt)].join('\n') + '\n');
    } finally {
      await ctx.close();
    }
  });

program
  .command('probe')
  .description('check live reachability of sources (one light request each)')
  .argument('[sources...]', 'source ids (default: all)')
  .action(async (ids: string[]) => {
    const ctx = createAppContext(loadConfig(), { persist: false });
    try {
      const resolved = ids.map((i) => resolveSourceId(i)).filter((x): x is SourceId => !!x);
      const reports = await probeSources(ctx, resolved.length ? resolved : undefined);
      for (const r of reports) {
        process.stdout.write(`${r.source.padEnd(16)} ${r.status.padEnd(8)} ${r.category ?? ''} ${r.httpStatus ?? ''} ${r.message} (${r.duration_ms}ms)\n`);
      }
    } finally {
      await ctx.close();
    }
  });

program
  .command('runs')
  .description('show recent runs from the database')
  .option('--limit <n>', 'number of runs', int('limit'), 10)
  .action(async (opts) => {
    const ctx = createAppContext(loadConfig());
    try {
      for (const run of ctx.repo?.listRuns(opts.limit) ?? []) {
        const s = run.summary as { deduplicated_jobs?: number; raw_jobs_found?: number; duration_ms?: number } | null;
        process.stdout.write(`${run.id}  ${run.started_at}  ${String(run.status).padEnd(10)} jobs=${s?.deduplicated_jobs ?? '-'} raw=${s?.raw_jobs_found ?? '-'} ${s?.duration_ms ? (s.duration_ms / 1000).toFixed(0) + 's' : ''}\n`);
      }
    } finally {
      await ctx.close();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  const log = createLogger({ level: 'error' });
  if (err instanceof ValidationError) log.error(err.message);
  else log.error((err as Error).message);
  process.exit(1);
});
