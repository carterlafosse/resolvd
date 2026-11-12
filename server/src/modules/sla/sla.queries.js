// SQL for SLA policies. Every function takes the client from withOrg.

// The policy for one priority in the current org, shaped like DEFAULT_SLA_POLICIES so
// computeDueDates can use it directly. Null if the org has no policy for it.
export async function findPolicy(client, priority) {
  const { rows } = await client.query(
    `SELECT response_minutes AS "responseMinutes", resolution_minutes AS "resolutionMinutes"
     FROM sla_policies
     WHERE organization_id = current_org_id() AND priority = $1`,
    [priority],
  );
  return rows[0] ?? null;
}

// Records every new SLA breach in every organization (see migration 008) and returns one
// row per breach: { ticket_id, org_id, clock }. This is the one SLA query that runs outside
// withOrg: the job has no org, so it calls a SECURITY DEFINER function through the pool.
export async function markSlaBreaches(db) {
  const { rows } = await db.query('SELECT ticket_id, org_id, clock FROM mark_sla_breaches()');
  return rows;
}

const POLICY_COLUMNS = 'priority, response_minutes, resolution_minutes, updated_at';

// ticket_priority is an enum, so DESC sorts by severity: critical, high, medium, low.
export async function listPolicies(client) {
  const { rows } = await client.query(
    `SELECT ${POLICY_COLUMNS} FROM sla_policies
     WHERE organization_id = current_org_id()
     ORDER BY priority DESC`,
  );
  return rows;
}

// An upsert, because PUT sets the policy whether or not the row exists. Every org gets all
// four at sign-up, so in practice this updates; the insert path keeps PUT correct regardless.
export async function upsertPolicy(client, priority, { responseMinutes, resolutionMinutes }) {
  const { rows } = await client.query(
    `INSERT INTO sla_policies (organization_id, priority, response_minutes, resolution_minutes)
     VALUES (current_org_id(), $1, $2, $3)
     ON CONFLICT (organization_id, priority) DO UPDATE
       SET response_minutes = EXCLUDED.response_minutes,
           resolution_minutes = EXCLUDED.resolution_minutes
     RETURNING ${POLICY_COLUMNS}`,
    [priority, responseMinutes, resolutionMinutes],
  );
  return rows[0];
}
