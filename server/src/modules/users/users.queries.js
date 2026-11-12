// SQL for the users table. Every function takes the client from withOrg, so RLS limits it to one org.

// Everything about a user except password_hash, which never leaves the database layer.
export const USER_COLUMNS = `id, organization_id, name, email, role, department, is_active,
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

// Technicians only need enough to fill an assignment dropdown.
const DIRECTORY_COLUMNS = 'id, name, role';

// A NULL filter parameter means "don't filter", which keeps the SQL fixed (no string building).
export async function listUsers(client, { role, active }, { full }) {
  const { rows } = await client.query(
    `SELECT ${full ? USER_COLUMNS : DIRECTORY_COLUMNS}
     FROM users
     WHERE organization_id = current_org_id()
       AND ($1::user_role IS NULL OR role = $1)
       AND ($2::boolean IS NULL OR is_active = $2)
     ORDER BY name, id`,
    [role ?? null, active ?? null],
  );
  return rows;
}

// Locks every active admin row, always in id order. Any request that could remove an admin
// takes these locks first, so two admins demoting each other at the same moment run one after
// the other and the second sees the first one's change. Same order everywhere = no deadlock.
export async function lockActiveAdmins(client) {
  const { rows } = await client.query(
    `SELECT id FROM users
     WHERE organization_id = current_org_id() AND role = 'admin' AND is_active
     ORDER BY id
     FOR UPDATE`,
  );
  return rows.map((r) => r.id);
}

// Includes password_hash for the password check in PATCH /users/me; the service never returns it.
export async function findUserForUpdate(client, id) {
  const { rows } = await client.query(
    `SELECT ${USER_COLUMNS}, password_hash
     FROM users WHERE id = $1 AND organization_id = current_org_id()
     FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

// API field name -> column. Only these columns can ever appear in the SET clause; values are
// always parameters, so request data never becomes SQL text.
const UPDATABLE_COLUMNS = {
  name: 'name',
  role: 'role',
  department: 'department',
  isActive: 'is_active',
  emailNotifications: 'email_notifications',
  passwordHash: 'password_hash',
};

export async function updateUser(client, id, changes) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (changes[field] === undefined) continue;
    values.push(changes[field]);
    sets.push(`${column} = $${values.length}`);
  }
  values.push(id);

  const { rows } = await client.query(
    `UPDATE users SET ${sets.join(', ')}
     WHERE id = $${values.length} AND organization_id = current_org_id()
     RETURNING ${USER_COLUMNS}`,
    values,
  );
  return rows[0];
}
