// SQL for tickets and their change events. Every function takes the client from withOrg.

// The joined names save the front end a lookup per row. display_id is built in SQL so every
// response formats it the same way.
const TICKET_COLUMNS = `t.id, t.organization_id, t.ticket_number,
  'RES-' || t.ticket_number AS display_id,
  t.title, t.description, t.status, t.priority,
  t.category_id, c.name AS category_name,
  t.requester_id, r.name AS requester_name,
  t.assignee_id, a.name AS assignee_name,
  t.response_due_at, t.resolution_due_at, t.first_response_at,
  t.resolved_at, t.closed_at, t.created_at, t.updated_at`;

// Joins match on organization_id as well as id, mirroring the composite foreign keys.
// category and assignee are LEFT JOINs because both can be empty.
const TICKET_JOINS = `FROM tickets t
  JOIN users r ON r.organization_id = t.organization_id AND r.id = t.requester_id
  LEFT JOIN categories c ON c.organization_id = t.organization_id AND c.id = t.category_id
  LEFT JOIN users a ON a.organization_id = t.organization_id AND a.id = t.assignee_id`;

// Claims the org's next ticket number in one statement. The UPDATE locks the organization
// row until the transaction ends, so two tickets created at the same moment queue up and
// get different numbers. A SELECT followed by an UPDATE could hand both the same number.
export async function claimTicketNumber(client) {
  const { rows } = await client.query(
    `UPDATE organizations SET next_ticket_number = next_ticket_number + 1
     WHERE id = current_org_id()
     RETURNING next_ticket_number - 1 AS ticket_number`,
  );
  return rows[0].ticket_number;
}

// organization_id comes from the transaction's org setting, never from request data.
export async function insertTicket(
  client,
  { ticketNumber, title, description, priority, categoryId, requesterId },
) {
  const { rows } = await client.query(
    `INSERT INTO tickets
       (organization_id, ticket_number, title, description, priority, category_id, requester_id)
     VALUES (current_org_id(), $1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [ticketNumber, title, description, priority, categoryId ?? null, requesterId],
  );
  return rows[0].id;
}

// One row in the ticket's history. Values are stored as text so every field fits one shape.
export async function insertEvent(client, { ticketId, actorId, field, oldValue, newValue }) {
  await client.query(
    `INSERT INTO ticket_events (organization_id, ticket_id, actor_id, field, old_value, new_value)
     VALUES (current_org_id(), $1, $2, $3, $4, $5)`,
    [ticketId, actorId, field, oldValue ?? null, newValue ?? null],
  );
}

// Null when the category doesn't exist in this org (including another org's category id).
export async function findCategoryName(client, categoryId) {
  const { rows } = await client.query(
    'SELECT name FROM categories WHERE id = $1 AND organization_id = current_org_id()',
    [categoryId],
  );
  return rows[0]?.name ?? null;
}

// requesterId limits the lookup to that requester's tickets (end users); null means any.
export async function findTicketById(client, id, { requesterId = null } = {}) {
  const { rows } = await client.query(
    `SELECT ${TICKET_COLUMNS}
     ${TICKET_JOINS}
     WHERE t.id = $1 AND t.organization_id = current_org_id()
       AND ($2::int IS NULL OR t.requester_id = $2)`,
    [id, requesterId],
  );
  return rows[0] ?? null;
}
