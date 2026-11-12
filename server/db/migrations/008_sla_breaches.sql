-- 008: Records when each SLA clock was found breached, and the function the SLA job calls to record breaches.

-- Set once per clock by mark_sla_breaches(). NULL means no breach has been recorded for the
-- ticket's current deadline. These columns are what make the job idempotent: a clock that
-- already has a value is skipped, so each breach is recorded (and its event written) once.
ALTER TABLE tickets
  ADD COLUMN response_breached_at   TIMESTAMPTZ,
  ADD COLUMN resolution_breached_at TIMESTAMPTZ;

-- Called every 5 minutes by the API's SLA job (src/jobs/slaChecker.js). It records new
-- breaches in every organization and returns one row per breach it recorded.
--
-- SECURITY DEFINER: the job works across all orgs, with no org set. As resolvd_app, row-level
-- security would hide every ticket; running as the owner bypasses RLS for this one narrow
-- job. search_path is pinned so a caller can't swap in look-alike tables.
--
-- The breach rule matches clockState() in src/modules/sla/sla.js: a clock is breached when it
-- has a deadline and was completed after it, or is still running past it.
--
-- Two statements, response then resolution. Doing both in one statement would mean two CTEs
-- updating the same ticket row, and Postgres doesn't apply two updates to one row in a single
-- statement (only one would take effect). Each statement updates the tickets and, in the same
-- statement, inserts one sla_breach event per ticket with actor_id NULL ("System").
--
-- Concurrency: if two runs overlapped, the second's UPDATE waits on the first's row locks,
-- then re-checks "breached_at IS NULL" and skips those rows, so a breach is never recorded twice.
CREATE FUNCTION mark_sla_breaches()
RETURNS TABLE (ticket_id INT, org_id INT, clock TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH breached AS (
    UPDATE tickets t SET response_breached_at = NOW()
    WHERE t.response_breached_at IS NULL
      AND t.response_due_at IS NOT NULL
      AND COALESCE(t.first_response_at, NOW()) > t.response_due_at
    RETURNING t.id, t.organization_id
  ), logged AS (
    INSERT INTO ticket_events (organization_id, ticket_id, actor_id, field, new_value)
    SELECT b.organization_id, b.id, NULL, 'sla_breach', 'response' FROM breached b
  )
  SELECT b.id, b.organization_id, 'response'::TEXT FROM breached b;

  RETURN QUERY
  WITH breached AS (
    UPDATE tickets t SET resolution_breached_at = NOW()
    WHERE t.resolution_breached_at IS NULL
      AND t.resolution_due_at IS NOT NULL
      AND COALESCE(t.resolved_at, NOW()) > t.resolution_due_at
    RETURNING t.id, t.organization_id
  ), logged AS (
    INSERT INTO ticket_events (organization_id, ticket_id, actor_id, field, new_value)
    SELECT b.organization_id, b.id, NULL, 'sla_breach', 'resolution' FROM breached b
  )
  SELECT b.id, b.organization_id, 'resolution'::TEXT FROM breached b;
END;
$$;

-- Only the API role may run it (functions are executable by everyone by default).
REVOKE ALL ON FUNCTION mark_sla_breaches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_sla_breaches() TO resolvd_app;
