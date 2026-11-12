// Transaction helpers; withOrg scopes a transaction to one organization for row-level security.
import { pool } from './pool.js';

// Runs work(client) inside BEGIN/COMMIT on one dedicated client, rolling back on any error.
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// is_local = true makes the setting end with the transaction, so it can never leak to the
// next request that borrows this pooled connection.
export async function setOrg(client, orgId) {
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
