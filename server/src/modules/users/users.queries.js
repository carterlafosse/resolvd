// SQL for the users table. Every function takes the client from withOrg, so RLS limits it to one org.

// Everything about a user except password_hash, which never leaves the database layer.
const USER_COLUMNS = `id, organization_id, name, email, role, department, is_active,
  email_notifications, locked_until, last_login_at, created_at, updated_at`;

// organization_id comes from the transaction's org setting, never from request data.
export async function insertUser(client, { name, email, passwordHash, role, department }) {
  const { rows } = await client.query(
    `INSERT INTO users (organization_id, name, email, password_hash, role, department)
     VALUES (current_org_id(), $1, $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [name, email, passwordHash, role, department ?? null],
  );
  return rows[0];
}

export async function findUserById(client, id) {
  const { rows } = await client.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND organization_id = current_org_id()`,
    [id],
  );
  return rows[0] ?? null;
}
