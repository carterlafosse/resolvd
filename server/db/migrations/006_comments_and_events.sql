-- 006: Ticket comments (public replies and internal notes) and the ticket audit log.

CREATE TABLE ticket_comments (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id),
  ticket_id       INT NOT NULL,
  author_id       INT NOT NULL,
  body            TEXT NOT NULL,
  is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_id) REFERENCES users (organization_id, id)
);

CREATE INDEX ticket_comments_ticket_created_idx ON ticket_comments (ticket_id, created_at);

-- One row per change to a ticket, written in the same transaction as the change.
CREATE TABLE ticket_events (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id),
  ticket_id       INT NOT NULL,
  actor_id        INT,                     -- NULL means the system (for example the SLA job)
  field           VARCHAR(50) NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets (organization_id, id) ON DELETE CASCADE,
  -- MATCH SIMPLE skips this check when actor_id is NULL, so system events are allowed.
  FOREIGN KEY (organization_id, actor_id)  REFERENCES users (organization_id, id)
);

CREATE INDEX ticket_events_ticket_created_idx ON ticket_events (ticket_id, created_at);
