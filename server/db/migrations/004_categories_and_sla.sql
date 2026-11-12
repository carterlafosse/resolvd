-- 004: Ticket categories and per-org SLA policies (one row per priority).

CREATE TABLE categories (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id),
  name            VARCHAR(100) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sla_policies (
  organization_id    INT NOT NULL REFERENCES organizations(id),
  priority           ticket_priority NOT NULL,
  response_minutes   INT NOT NULL,
  resolution_minutes INT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, priority),
  CHECK (response_minutes > 0 AND resolution_minutes > response_minutes)
);

CREATE TRIGGER sla_policies_updated_at BEFORE UPDATE ON sla_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
