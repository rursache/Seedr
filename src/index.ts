import { SeedManager } from './core/seed-manager.js';
import { startWebServer } from './web/server.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('main');

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

async function main(): Promise<void> {
  const demoMode = process.argv.includes('--demo');

  logger.info(demoMode ? 'Starting Seedr in DEMO mode...' : 'Starting Seedr...');

  const seedManager = new SeedManager(demoMode);
  await seedManager.init();

  // Start web server
  const { server, io } = await startWebServer(seedManager);

  // Start seeding (skip in demo mode — no real network activity)
  if (!demoMode) {
    await seedManager.start();
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    await seedManager.destroy();

    io.close();
    await server.close();

    logger.info('Goodbye');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Seedr is running');
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
