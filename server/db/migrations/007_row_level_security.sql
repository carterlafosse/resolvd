-- 007: Row-level security, the auth/sign-up functions that must work before an org is known, and grants.

-- The org for the current transaction, set by the API's withOrg() helper.
-- current_setting(..., true) returns NULL (or '' once used in this session) instead of erroring
-- when the setting is missing; both become NULL, and "organization_id = NULL" matches no rows.
CREATE FUNCTION current_org_id() RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::INT
$$;

-- ----- Row-level security -----
-- RLS doesn't apply to the table owner (resolvd_owner), only to resolvd_app, which the API uses.

ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;

-- USING filters the rows you can read, update or delete; WITH CHECK stops you writing a row into another org.
CREATE POLICY org_isolation ON users
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY org_isolation ON categories
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY org_isolation ON sla_policies
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY org_isolation ON tickets
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY org_isolation ON ticket_comments
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY org_isolation ON ticket_events
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- An org can only see (and update) its own organizations row.
CREATE POLICY org_self ON organizations
  USING (id = current_org_id());

-- ----- SECURITY DEFINER functions -----
-- These run with the owner's rights, so they bypass RLS. Each does exactly one narrow job that
-- can't work under RLS, and search_path is pinned so a caller can't swap in look-alike tables.

-- Login: we don't know the user's org until we've found them by email.
CREATE FUNCTION auth_find_user_by_email(p_email TEXT)
RETURNS TABLE (
  id                    INT,
  organization_id       INT,
  password_hash         TEXT,
  role                  user_role,
  is_active             BOOLEAN,
  failed_login_attempts INT,
  locked_until          TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.organization_id, u.password_hash, u.role, u.is_active,
         u.failed_login_attempts, u.locked_until
  FROM users u
  WHERE LOWER(u.email) = LOWER(p_email)
$$;

-- Login failure: called on its own (outside any transaction that rolls back) so the count is saved.
-- On reaching the limit the account is locked and the counter starts again from 0.
CREATE FUNCTION auth_record_login_failure(p_user_id INT, p_max_attempts INT, p_lock_minutes INT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE users SET
    failed_login_attempts = CASE
      WHEN failed_login_attempts + 1 >= p_max_attempts THEN 0
      ELSE failed_login_attempts + 1
    END,
    locked_until = CASE
      WHEN failed_login_attempts + 1 >= p_max_attempts THEN NOW() + make_interval(mins => p_lock_minutes)
      ELSE locked_until
    END
  WHERE id = p_user_id
$$;

-- Sign-up: the new org doesn't exist yet, so there's no org to set, and resolvd_app can't INSERT here.
CREATE FUNCTION create_organization(p_name TEXT, p_slug TEXT)
RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO organizations (name, slug) VALUES (p_name, p_slug) RETURNING id
$$;

-- ----- Grants for the API role (least privilege: no DDL, no DROP, no access to schema_migrations) -----

GRANT USAGE ON SCHEMA public TO resolvd_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, categories, sla_policies, tickets, ticket_comments, ticket_events TO resolvd_app;
GRANT SELECT, UPDATE ON organizations TO resolvd_app;
-- Needed for SERIAL ids on insert. Later migrations grant their own new sequences.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO resolvd_app;

-- Functions are executable by everyone by default; restrict these three to the API role.
REVOKE ALL ON FUNCTION auth_find_user_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_record_login_failure(INT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_organization(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(TEXT) TO resolvd_app;
GRANT EXECUTE ON FUNCTION auth_record_login_failure(INT, INT, INT) TO resolvd_app;
GRANT EXECUTE ON FUNCTION create_organization(TEXT, TEXT) TO resolvd_app;
