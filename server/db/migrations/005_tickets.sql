-- 005: Tickets, with composite foreign keys so a ticket can only point at rows in its own org.

CREATE TABLE tickets (
  id                SERIAL PRIMARY KEY,
  organization_id   INT NOT NULL REFERENCES organizations(id),
  ticket_number     INT NOT NULL,          -- per-org, displayed as RES-1001
  title             VARCHAR(200) NOT NULL,
  description       TEXT NOT NULL,
  status            ticket_status NOT NULL DEFAULT 'open',
  priority          ticket_priority NOT NULL DEFAULT 'medium',
  category_id       INT,
  requester_id      INT NOT NULL,
  assignee_id       INT,
  response_due_at   TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ticket_number),
  UNIQUE (organization_id, id),
  -- With the default MATCH SIMPLE, a NULL category_id or assignee_id skips the check,
  -- which is what an uncategorized or unassigned ticket needs.
  FOREIGN KEY (organization_id, category_id)  REFERENCES categories (organization_id, id),
  FOREIGN KEY (organization_id, requester_id) REFERENCES users (organization_id, id),
  FOREIGN KEY (organization_id, assignee_id)  REFERENCES users (organization_id, id)
);

CREATE INDEX tickets_org_status_idx   ON tickets (organization_id, status);
CREATE INDEX tickets_org_assignee_idx ON tickets (organization_id, assignee_id);
-- Partial: only unfinished tickets have a deadline worth checking, so the index stays small.
CREATE INDEX tickets_org_due_idx      ON tickets (organization_id, resolution_due_at)
  WHERE status NOT IN ('resolved', 'closed');

CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
