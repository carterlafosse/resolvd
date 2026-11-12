-- One-time setup, run as the postgres superuser: creates the two Resolvd roles and databases.
--
-- Usage (PowerShell, from the repo root). Passwords come from psql variables, never from this file:
--   psql -U postgres -v owner_pw="..." -v app_pw="..." -f server/db/setup.sql
--
-- Safe to run more than once: anything that already exists is skipped (existing passwords are left alone).
--
-- psql variables don't expand inside DO $$ ... $$ blocks, and CREATE DATABASE can't run inside one,
-- so each statement is built with SELECT format(...) and executed by \gexec only when it's missing.

\set ON_ERROR_STOP on

-- Stop with a clear message if either password variable was left off the command line.
\if :{?owner_pw}
\else
  \echo 'Missing -v owner_pw="...". See the usage line at the top of this file. Nothing was changed.'
  \quit
\endif
\if :{?app_pw}
\else
  \echo 'Missing -v app_pw="...". See the usage line at the top of this file. Nothing was changed.'
  \quit
\endif

-- resolvd_owner owns the tables and runs migrations and seeds.
SELECT format('CREATE ROLE resolvd_owner LOGIN PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolvd_owner')
\gexec

-- resolvd_app is what the API connects as. It doesn't own the tables, so row-level security applies to it.
SELECT format('CREATE ROLE resolvd_app LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolvd_app')
\gexec

SELECT 'CREATE DATABASE resolvd_dev OWNER resolvd_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'resolvd_dev')
\gexec

SELECT 'CREATE DATABASE resolvd_test OWNER resolvd_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'resolvd_test')
\gexec

\echo 'Roles resolvd_owner and resolvd_app and databases resolvd_dev and resolvd_test are ready.'
