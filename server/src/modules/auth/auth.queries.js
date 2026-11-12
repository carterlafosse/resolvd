// SQL for sign-up and login: creating an organization with its defaults, and the login lookups.

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
