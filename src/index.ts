import { SeedManager } from './core/seed-manager.js';
import { startWebServer } from './web/server.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('Starting Seedr...');

  const seedManager = new SeedManager();
  await seedManager.init();

  // Start web server
  const { server, io } = await startWebServer(seedManager);

  // Start seeding
  await seedManager.start();

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
