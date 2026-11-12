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
