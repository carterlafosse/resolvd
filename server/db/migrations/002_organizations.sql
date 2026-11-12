-- 002: Organizations (tenants). Every other tenant table points back here.

CREATE TABLE organizations (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(100) NOT NULL,
  slug               VARCHAR(50) UNIQUE NOT NULL,
  -- Per-org ticket counter, claimed with UPDATE ... RETURNING so numbers never collide (Phase 4).
  next_ticket_number INT NOT NULL DEFAULT 1001,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
