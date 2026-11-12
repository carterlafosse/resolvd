// The API's single PostgreSQL connection pool, connected as the non-owner resolvd_app role.
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  // Fail fast instead of hanging a request (or the health check) when the database is down.
  connectionTimeoutMillis: 5000,
});

// Without this listener, an idle client dropped by the server (restart, network blip)
// emits an unhandled 'error' event and crashes the whole process.
pool.on('error', (err) => {
  logger.error({ err }, 'Idle database client error');
});
