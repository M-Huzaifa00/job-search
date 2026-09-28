import { buildApp } from './api/app.ts';
import { loadConfig } from './config/env.ts';
import { createAppContext } from './services/context.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createAppContext(config);
  const app = await buildApp(ctx);
  const log = ctx.logger.child('Server');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    await app.close().catch(() => {});
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  log.info(`API listening on http://localhost:${config.port}`, { host: config.host, database: config.persist ? config.databasePath : 'disabled' });
  log.info('try: curl http://localhost:' + config.port + '/api/sources');
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
