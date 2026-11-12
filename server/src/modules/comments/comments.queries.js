// SQL for ticket comments. Every function takes the client from withOrg.

// The author's name and role let the front end label staff replies without another request.
const COMMENT_COLUMNS = `c.id, c.ticket_id, c.author_id, u.name AS author_name,
  u.role AS author_role, c.body, c.is_internal, c.created_at`;

// The join matches on organization_id as well as id, mirroring the composite foreign key.
const AUTHOR_JOIN = 'JOIN users u ON u.organization_id = c.organization_id AND u.id = c.author_id';

// Oldest first, like a conversation. includeInternal is false for end users, and then internal
// notes are filtered out here in SQL: they never leave the database, so no later code path
// can forget to remove them.
export async function listComments(client, ticketId, { includeInternal }) {
  const { rows } = await client.query(
    `SELECT ${COMMENT_COLUMNS}
     FROM ticket_comments c
     ${AUTHOR_JOIN}
     WHERE c.ticket_id = $1 AND c.organization_id = current_org_id()
       AND ($2::boolean OR NOT c.is_internal)
     ORDER BY c.created_at, c.id`,
    [ticketId, includeInternal],
  );
  return rows;
}

// Inserts and returns the comment in the same shape as the list, in one statement.
// organization_id comes from the transaction's org setting, never from request data.
export async function insertComment(client, { ticketId, authorId, body, isInternal }) {
  const { rows } = await client.query(
    `WITH c AS (
       INSERT INTO ticket_comments (organization_id, ticket_id, author_id, body, is_internal)
       VALUES (current_org_id(), $1, $2, $3, $4)
       RETURNING *
     )
     SELECT ${COMMENT_COLUMNS}
     FROM c
     ${AUTHOR_JOIN}`,
    [ticketId, authorId, body, isInternal],
  );
  return rows[0];
}
