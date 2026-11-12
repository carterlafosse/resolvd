-- 001: Enum types and the shared updated_at trigger function.

-- Enum declaration order is the sort order, so ORDER BY priority goes low -> critical.
CREATE TYPE user_role AS ENUM ('end_user', 'technician', 'admin');
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'on_hold', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Attached as a BEFORE UPDATE trigger so updated_at can't be forgotten by application code.
CREATE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
