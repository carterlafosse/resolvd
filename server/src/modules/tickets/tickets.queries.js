// SQL for tickets and their change events. Every function takes the client from withOrg.
import { AT_RISK_SHARE } from '../sla/sla.js';

// What a queue row needs. The joined names save the front end a lookup per row, and
// display_id is built in SQL so every response formats it the same way.
const SUMMARY_COLUMNS = `t.id, t.organization_id, t.ticket_number,
  'RES-' || t.ticket_number AS display_id,
  t.title, t.status, t.priority,
  t.category_id, c.name AS category_name,
  t.requester_id, r.name AS requester_name,
  t.assignee_id, a.name AS assignee_name,
  t.response_due_at, t.resolution_due_at, t.first_response_at,
  t.resolved_at, t.closed_at, t.created_at, t.updated_at`;

// A single ticket also carries its description (up to 5,000 characters, so lists leave it out).
const TICKET_COLUMNS = `${SUMMARY_COLUMNS}, t.description`;

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
// Returns the new id and created_at, which the SLA deadlines are counted from.
export async function insertTicket(
  client,
  { ticketNumber, title, description, priority, categoryId, requesterId },
) {
  const { rows } = await client.query(
    `INSERT INTO tickets
       (organization_id, ticket_number, title, description, priority, category_id, requester_id)
     VALUES (current_org_id(), $1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [ticketNumber, title, description, priority, categoryId ?? null, requesterId],
  );
  return rows[0];
}

// One row in the ticket's history. Values are stored as text so every field fits one shape.
export async function insertEvent(client, { ticketId, actorId, field, oldValue, newValue }) {
  await client.query(
    `INSERT INTO ticket_events (organization_id, ticket_id, actor_id, field, old_value, new_value)
     VALUES (current_org_id(), $1, $2, $3, $4, $5)`,
    [ticketId, actorId, field, oldValue ?? null, newValue ?? null],
  );
}

// Joins an event to the person who made it. LEFT JOIN because actor_id is NULL for changes
// the system made (for example the SLA job), shown as "System".
const ACTOR_JOIN =
  'LEFT JOIN users u ON u.organization_id = e.organization_id AND u.id = e.actor_id';

// A ticket's change history, newest first. Unless includeAll is true (staff), only events
// whose field is in publicFields are returned; the filter runs in SQL so hidden events never
// leave the database. Events written in one transaction share created_at, so id breaks ties.
export async function listEvents(client, ticketId, { includeAll, publicFields }) {
  const { rows } = await client.query(
    `SELECT e.id, e.ticket_id, e.actor_id, COALESCE(u.name, 'System') AS actor_name,
            e.field, e.old_value, e.new_value, e.created_at
     FROM ticket_events e
     ${ACTOR_JOIN}
     WHERE e.ticket_id = $1 AND e.organization_id = current_org_id()
       AND ($2::boolean OR e.field = ANY($3::text[]))
     ORDER BY e.created_at DESC, e.id DESC`,
    [ticketId, includeAll, publicFields],
  );
  return rows;
}

// Comments and events merged into one feed, oldest first, in one shape:
// type ('comment' | 'event'), id, actor_name, body, field, old_value, new_value, is_internal,
// created_at. Columns that don't apply to a row type are NULL.
// Visibility is the same as the comments and events endpoints: unless includeAll (staff),
// internal notes and non-public events are filtered out here in SQL. An event's is_internal
// says whether it's hidden from end users, so the front end can mark both kinds the same way.
// Ties on created_at (a requester's reply and the status change it caused share one
// transaction) sort comments before events ('comment' < 'event'), then by id.
export async function listActivity(client, ticketId, { includeAll, publicFields }) {
  const { rows } = await client.query(
    `SELECT type, id, actor_name, body, field, old_value, new_value, is_internal, created_at
     FROM (
       SELECT 'comment' AS type, c.id, a.name AS actor_name, c.body,
              NULL::varchar AS field, NULL::text AS old_value, NULL::text AS new_value,
              c.is_internal, c.created_at
       FROM ticket_comments c
       JOIN users a ON a.organization_id = c.organization_id AND a.id = c.author_id
       WHERE c.ticket_id = $1 AND c.organization_id = current_org_id()
         AND ($2::boolean OR NOT c.is_internal)

       UNION ALL

       SELECT 'event', e.id, COALESCE(u.name, 'System'), NULL,
              e.field, e.old_value, e.new_value,
              NOT (e.field = ANY($3::text[])), e.created_at
       FROM ticket_events e
       ${ACTOR_JOIN}
       WHERE e.ticket_id = $1 AND e.organization_id = current_org_id()
         AND ($2::boolean OR e.field = ANY($3::text[]))
     ) activity
     ORDER BY created_at, type, id`,
    [ticketId, includeAll, publicFields],
  );
  return rows;
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

// Just enough to decide whether the caller can see a ticket, for endpoints that read its
// comments or history without changing it (so no lock).
export async function findTicketAccess(client, id) {
  const { rows } = await client.query(
    `SELECT id, requester_id, status FROM tickets
     WHERE id = $1 AND organization_id = current_org_id()`,
    [id],
  );
  return rows[0] ?? null;
}

// Loads a ticket and locks its row until the transaction ends, so two people changing the same
// ticket at once run one after the other and each sees the other's result. Category and
// assignee names are included because change events record them by name, and the SLA
// columns because a priority change recalculates the deadlines.
// FOR UPDATE OF t locks only the ticket: Postgres can't lock the nullable side of a LEFT JOIN,
// and the category and assignee rows don't need locking.
export async function lockTicket(client, id) {
  const { rows } = await client.query(
    `SELECT t.id, t.requester_id, t.status, t.title, t.description, t.priority,
            t.category_id, c.name AS category_name,
            t.assignee_id, a.name AS assignee_name,
            t.created_at, t.response_due_at, t.resolution_due_at,
            t.response_breached_at, t.resolution_breached_at,
            t.first_response_at, t.resolved_at, t.updated_at
     FROM tickets t
     LEFT JOIN categories c ON c.organization_id = t.organization_id AND c.id = t.category_id
     LEFT JOIN users a ON a.organization_id = t.organization_id AND a.id = t.assignee_id
     WHERE t.id = $1 AND t.organization_id = current_org_id()
     FOR UPDATE OF t`,
    [id],
  );
  return rows[0] ?? null;
}

// The user, if they can be given tickets: an active technician or admin in this org.
// FOR SHARE stops the user being deactivated or demoted until this transaction commits, so a
// ticket can't end up assigned to someone who stopped being assignable a moment earlier.
export async function findAssignableUser(client, userId) {
  const { rows } = await client.query(
    `SELECT id, name FROM users
     WHERE id = $1 AND organization_id = current_org_id()
       AND is_active AND role IN ('technician', 'admin')
     FOR SHARE`,
    [userId],
  );
  return rows[0] ?? null;
}

// Field name -> column. Only these columns can ever appear in the SET clause; values are
// always parameters. The service decides which fields a request may change; a value of
// null clears the column, undefined leaves it alone.
const UPDATABLE_COLUMNS = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  categoryId: 'category_id',
  status: 'status',
  assigneeId: 'assignee_id',
  firstResponseAt: 'first_response_at',
  responseDueAt: 'response_due_at',
  resolutionDueAt: 'resolution_due_at',
  responseBreachedAt: 'response_breached_at',
  resolutionBreachedAt: 'resolution_breached_at',
  resolvedAt: 'resolved_at',
  closedAt: 'closed_at',
};

export async function updateTicket(client, id, changes) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (changes[field] === undefined) continue;
    values.push(changes[field]);
    sets.push(`${column} = $${values.length}`);
  }
  values.push(id);

  await client.query(
    `UPDATE tickets SET ${sets.join(', ')}
     WHERE id = $${values.length} AND organization_id = current_org_id()`,
    values,
  );
}

// Sort names from the API -> SQL. Only these fixed strings can ever reach ORDER BY; the schema
// already limits `sort` and `order` to these keys, and the lookup below refuses anything else.
const SORT_COLUMNS = {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  // ticket_priority is an enum, so it sorts in declaration order: low < medium < high < critical.
  priority: 't.priority',
  resolution_due_at: 't.resolution_due_at',
};
const SORT_DIRECTIONS = { asc: 'ASC', desc: 'DESC' };

// The SLA clocks in SQL, for the sla= list filters. These mirror clockState() in
// sla/sla.js so the filter returns exactly the tickets whose sla.overall says the same thing;
// a test checks that. `now` is a placeholder for the request's clock, which the service also
// uses for each row's summary. A clock is "done" once its completing timestamp is set.
function slaClockSql(now) {
  const clocks = [
    { due: 't.response_due_at', done: 't.first_response_at' },
    { due: 't.resolution_due_at', done: 't.resolved_at' },
  ];
  // Completed after the deadline, or still running past it.
  const breached = ({ due, done }) => `(${due} IS NOT NULL AND COALESCE(${done}, ${now}) > ${due})`;
  // Still running, not past the deadline, and less than 25% of the window left.
  const atRisk = ({ due, done }) =>
    `(${due} IS NOT NULL AND ${done} IS NULL AND ${now} <= ${due}
      AND ${due} - ${now} < (${due} - t.created_at) * ${AT_RISK_SHARE})`;

  const anyBreached = `(${clocks.map(breached).join(' OR ')})`;
  return {
    breached: anyBreached,
    // The overall state is the worse clock, so a ticket with one clock breached is breached,
    // not at risk.
    at_risk: `(NOT ${anyBreached} AND (${clocks.map(atRisk).join(' OR ')}))`,
  };
}

// Builds the WHERE clause for the list from optional filters. Each value goes into the params
// array and only its placeholder ($1, $2, ...) goes into the SQL text, so request data never
// becomes SQL. The SQL fragments themselves are all fixed strings written here.
function buildTicketFilters(filters) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const conditions = ['t.organization_id = current_org_id()'];
  if (filters.requesterId != null) {
    conditions.push(`t.requester_id = ${param(filters.requesterId)}`);
  }
  if (filters.statuses) {
    conditions.push(`t.status = ANY(${param(filters.statuses)}::ticket_status[])`);
  }
  if (filters.priorities) {
    conditions.push(`t.priority = ANY(${param(filters.priorities)}::ticket_priority[])`);
  }
  if (filters.unassigned) {
    conditions.push('t.assignee_id IS NULL');
  } else if (filters.assigneeId != null) {
    conditions.push(`t.assignee_id = ${param(filters.assigneeId)}`);
  }
  if (filters.categoryId != null) {
    conditions.push(`t.category_id = ${param(filters.categoryId)}`);
  }
  if (filters.titlePattern) {
    const titleMatch = `t.title ILIKE ${param(filters.titlePattern)}`;
    conditions.push(
      filters.ticketNumber != null
        ? `(${titleMatch} OR t.ticket_number = ${param(filters.ticketNumber)})`
        : titleMatch,
    );
  }
  if (filters.sla) {
    // One parameter for the clock, used in every comparison. The schema limits sla to the
    // two keys of slaClockSql, and the lookup refuses anything else.
    const condition = slaClockSql(`${param(filters.now)}::timestamptz`)[filters.sla];
    if (!condition) throw new Error(`Unsupported SLA filter: ${filters.sla}`);
    conditions.push(condition);
  }

  return { where: conditions.join('\n       AND '), params, param };
}

// One page of tickets plus the total number of matches.
// COUNT(*) OVER() counts every row that matched the WHERE clause, before LIMIT/OFFSET cut it
// down to one page, so the total comes back with the page in a single query.
export async function listTickets(client, filters, { sort, order, limit, offset }) {
  const sortColumn = SORT_COLUMNS[sort];
  const direction = SORT_DIRECTIONS[order];
  if (!sortColumn || !direction) throw new Error(`Unsupported ticket sort: ${sort} ${order}`);

  const { where, params, param } = buildTicketFilters(filters);
  const { rows } = await client.query(
    `SELECT ${SUMMARY_COLUMNS}, COUNT(*) OVER()::int AS total_count
     ${TICKET_JOINS}
     WHERE ${where}
     ORDER BY ${sortColumn} ${direction} NULLS LAST, t.id DESC
     LIMIT ${param(limit)} OFFSET ${param(offset)}`,
    params,
  );

  // A page past the end has no rows to carry total_count, so count separately (rare).
  let total = rows[0]?.total_count ?? 0;
  if (rows.length === 0 && offset > 0) total = await countTickets(client, filters);

  // eslint-disable-next-line no-unused-vars -- total_count is dropped from each row
  return { rows: rows.map(({ total_count, ...ticket }) => ticket), total };
}

async function countTickets(client, filters) {
  const { where, params } = buildTicketFilters(filters);
  const { rows } = await client.query(
    `SELECT count(*)::int AS total FROM tickets t WHERE ${where}`,
    params,
  );
  return rows[0].total;
}
