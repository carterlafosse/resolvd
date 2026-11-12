-- Row-level security demo for the screenshot. Run as the API role (resolvd_app), from the server folder:
--   psql -U resolvd_app -d resolvd_dev -f ..\docs\rls-demo.sql
-- Expects the seed data (org 1 = Acme Corp, org 2 = Globex).

\echo ''
\echo '== 1. Connected as resolvd_app with no organization set =='
SELECT current_user AS connected_as, current_org_id() AS current_org;
SELECT count(*) AS users_visible FROM users;

\echo ''
\echo '== 2. Inside a transaction with app.current_org_id = 1 (Acme Corp) =='
BEGIN;
SELECT set_config('app.current_org_id', '1', true) AS org_set_to;
SELECT name FROM organizations;
SELECT name, email FROM users;
COMMIT;

\echo ''
\echo '== 3. After COMMIT the setting is gone, so no rows are visible again =='
SELECT current_org_id() AS current_org;
SELECT count(*) AS users_visible FROM users;
