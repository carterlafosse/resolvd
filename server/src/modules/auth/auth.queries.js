// SQL for sign-up and login: creating an organization with its defaults, and the login lookups.
import { USER_COLUMNS } from '../users/users.queries.js';

// ----- Login -----
// The first two run on the pool, outside any org transaction: the user's org isn't known
// yet, and RLS would hide every user. Both are narrow SECURITY DEFINER functions.

export async function findUserForLogin(db, email) {
  const { rows } = await db.query('SELECT * FROM auth_find_user_by_email($1)', [email]);
  return rows[0] ?? null;
}

// Runs as its own statement (autocommit), so the count is saved even though login then fails.
export async function recordLoginFailure(db, userId, maxAttempts, lockMinutes) {
  await db.query('SELECT auth_record_login_failure($1, $2, $3)', [
    userId,
    maxAttempts,
    lockMinutes,
  ]);
}

// Runs inside withOrg once the password is confirmed.
export async function recordLoginSuccess(client, userId) {
  const { rows } = await client.query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
     WHERE id = $1 AND organization_id = current_org_id()
     RETURNING ${USER_COLUMNS}`,
    [userId],
  );
  return rows[0];
}

// ----- Sign-up -----

// SECURITY DEFINER: resolvd_app can't insert organizations directly, and the new org has no
// id to set as the current org until this returns.
export async function createOrganization(client, name, slug) {
  const { rows } = await client.query('SELECT create_organization($1, $2) AS id', [name, slug]);
  return rows[0].id;
}

export async function findCurrentOrganization(client) {
  const { rows } = await client.query(
    'SELECT id, name, slug FROM organizations WHERE id = current_org_id()',
  );
  return rows[0] ?? null;
}

export async function insertCategories(client, names) {
  await client.query(
    'INSERT INTO categories (organization_id, name) SELECT current_org_id(), unnest($1::text[])',
    [names],
  );
}

export async function insertSlaPolicies(client, policies) {
  await client.query(
    `INSERT INTO sla_policies (organization_id, priority, response_minutes, resolution_minutes)
     SELECT current_org_id(), p.priority, p.response_minutes, p.resolution_minutes
     FROM unnest($1::ticket_priority[], $2::int[], $3::int[])
       AS p (priority, response_minutes, resolution_minutes)`,
    [
      policies.map((p) => p.priority),
      policies.map((p) => p.responseMinutes),
      policies.map((p) => p.resolutionMinutes),
    ],
  );
}
