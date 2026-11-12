// Entry point: starts the HTTP server and shuts it down cleanly on SIGTERM (Render) or SIGINT (Ctrl+C).
import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { startSlaChecker } from './jobs/slaChecker.js';
import { logger } from './utils/logger.js';

const app = createApp();

// Tests never start the schedule; they call runSlaCheck() directly when they need a check.
const slaChecker = env.NODE_ENV === 'test' ? null : startSlaChecker();

// Express 5 passes listen errors (such as the port already being in use) to this callback.
const server = app.listen(env.PORT, (err) => {
  if (err) {
    logger.error({ err }, 'Server failed to start');
    process.exit(1);
  }
  logger.info(`Resolvd API listening on http://localhost:${env.PORT}`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  // If open connections keep server.close() waiting, don't hang forever.
  setTimeout(() => {
    logger.error('Shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000).unref();

  // No new SLA checks once shutdown starts. A check already running finishes, because
  // pool.end() below waits for its connection to be released.
  slaChecker?.stop();

  // Stop accepting new connections and let in-flight requests finish, then close the pool.
  server.close(async (err) => {
    if (err) logger.error({ err }, 'Error while closing the HTTP server');
    try {
      await pool.end();
    } catch (poolErr) {
      logger.error({ err: poolErr }, 'Error while closing the database pool');
    }
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
