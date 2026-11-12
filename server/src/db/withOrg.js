// Transaction helpers; withOrg scopes a transaction to one organization for row-level security.
import { logger } from '../utils/logger.js';
import { pool } from './pool.js';

// Runs work(client) inside BEGIN/COMMIT on one dedicated client, rolling back on any error.
export async function withTransaction(work) {
  const client = await pool.connect();
  // Set when the connection itself is broken; passing it to release() makes the pool
  // destroy the client instead of handing a dead connection to the next request.
  let brokenConnection;
  // The pool only listens for errors on idle clients. A connection that dies while checked
  // out emits 'error' on the client, and with no listener that crashes the whole process.
  const onClientError = (err) => {
    brokenConnection ??= err;
    logger.warn({ err }, 'Database connection error during a transaction');
  };
  client.on('error', onClientError);
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // If ROLLBACK fails the connection is gone. Rethrow the original error, which says
      // what actually went wrong, rather than the rollback failure.
      brokenConnection = rollbackErr;
      logger.warn({ err: rollbackErr }, 'Rollback failed; discarding the connection');
    }
    throw err;
  } finally {
    // A broken client keeps the listener: it's being destroyed, and its socket can still
    // report errors after release. A healthy one goes back to the pool without it.
    if (!brokenConnection) client.removeListener('error', onClientError);
    client.release(brokenConnection);
  }
}

// is_local = true makes the setting end with the transaction, so it can never leak to the
// next request that borrows this pooled connection.
export async function setOrg(client, orgId) {
  // Fails loudly before touching the database. A missing or malformed id (undefined, "",
  // "1 OR 1=1", 0) is always a bug in our code, and silently setting it could mean the
  // transaction runs with no org (every row hidden) or the wrong one.
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new TypeError(`setOrg expects a positive integer org id, got ${JSON.stringify(orgId)}`);
  }
  await client.query("SELECT set_config('app.current_org_id', $1, true)", [String(orgId)]);
}

// Every tenant query must use the client passed to work: pool.query would run on a different
// connection where app.current_org_id is unset, and RLS would hide every row.
export function withOrg(orgId, work) {
  return withTransaction(async (client) => {
    await setOrg(client, orgId);
    return work(client);
  });
}
