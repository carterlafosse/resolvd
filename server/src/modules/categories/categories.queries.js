// SQL for the categories table. Every function takes the client from withOrg.

const CATEGORY_COLUMNS = 'id, organization_id, name, created_at, updated_at';

export async function listCategories(client) {
  const { rows } = await client.query(
    `SELECT ${CATEGORY_COLUMNS} FROM categories
     WHERE organization_id = current_org_id()
     ORDER BY name, id`,
  );
  return rows;
}

export async function insertCategory(client, name) {
  const { rows } = await client.query(
    `INSERT INTO categories (organization_id, name) VALUES (current_org_id(), $1)
     RETURNING ${CATEGORY_COLUMNS}`,
    [name],
  );
  return rows[0];
}

// Returns null when the id doesn't exist in this org (including another org's id).
export async function renameCategory(client, id, name) {
  const { rows } = await client.query(
    `UPDATE categories SET name = $2
     WHERE id = $1 AND organization_id = current_org_id()
     RETURNING ${CATEGORY_COLUMNS}`,
    [id, name],
  );
  return rows[0] ?? null;
}
