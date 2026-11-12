-- 003: Users. Columns are shared with ScreenGuide AI, so they must not change.

CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  organization_id       INT NOT NULL REFERENCES organizations(id),
  name                  VARCHAR(100) NOT NULL,
  email                 VARCHAR(255) NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  user_role NOT NULL DEFAULT 'end_user',
  department            VARCHAR(100),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  email_notifications   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Target for composite foreign keys, so other tables can only reference a user in the same org.
  UNIQUE (organization_id, id)
);

-- Emails are unique across all organizations (login doesn't ask which org), ignoring case.
CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
