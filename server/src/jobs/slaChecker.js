// Background job: every 5 minutes, records SLA breaches across all organizations as ticket events.
import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { markSlaBreaches } from '../modules/sla/sla.queries.js';
import { logger } from '../utils/logger.js';

// Minute 0, 5, 10, ... of every hour.
const SCHEDULE = '*/5 * * * *';

// One check: records every new breach and returns them. Throws if the database call fails.
// Safe to run any number of times (idempotent): mark_sla_breaches() skips any clock whose
// breach is already recorded, so running it twice in a row records nothing the second time.
// Exported so tests can run a check without waiting for the schedule.
export async function runSlaCheck() {
  const breaches = await markSlaBreaches(pool);
  if (breaches.length > 0) {
    logger.info(
      { count: breaches.length, breaches },
      `SLA check recorded ${breaches.length} breach(es)`,
    );
  } else {
    logger.debug('SLA check found no new breaches');
  }
  return breaches;
}

let running = false;

// What the schedule calls. Two guarantees the plain runSlaCheck() doesn't give:
// - Overlap guard: if the previous check is still running (a slow or stuck database), this
//   one is skipped rather than piling up connections. Idempotency would make an overlap
//   harmless for the data; the guard keeps it from wasting the pool.
// - Never throws: a failed check is logged and the next one tries again in 5 minutes. An
//   error escaping here would be an unhandled rejection, which stops the whole API.
// Returns 'skipped', 'failed' or 'done' (for tests and the log).
export async function runScheduledSlaCheck() {
  if (running) {
    logger.warn('Previous SLA check is still running; skipping this one');
    return 'skipped';
  }
  running = true;
  try {
    await runSlaCheck();
    return 'done';
  } catch (err) {
    logger.error({ err }, 'SLA check failed; will retry on the next run');
    return 'failed';
  } finally {
    running = false;
  }
}

// Starts the schedule and returns the task, which server.js stops during shutdown.
export function startSlaChecker() {
  const task = cron.schedule(SCHEDULE, runScheduledSlaCheck, { name: 'sla-checker' });
  logger.info('SLA checker scheduled every 5 minutes');
  return task;
}
