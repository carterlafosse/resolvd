# Resolvd architecture

How Resolvd is designed and why. Each phase adds to the relevant section.

## Overview

## Request flow

## Database

PostgreSQL 18, written as raw SQL in numbered migrations (`server/db/migrations/`). `npm run migrate` applies each pending file and records it in `schema_migrations` inside one transaction, so a failed migration leaves nothing half-built. Committed migrations are never edited; fixes go in a new file.

### Tables

- `organizations`: one row per tenant (company, school or club), plus the per-org ticket counter.
- `users`: everyone who signs in, with their role (`end_user`, `technician`, `admin`) and lockout fields. Emails are unique across all orgs, ignoring case.
- `categories`: each org's ticket categories.
- `sla_policies`: each org's response and resolution targets, one row per priority.
- `tickets`: the helpdesk tickets, numbered per org (RES-1001, ...), with SLA deadlines stored on the row.
- `ticket_comments`: public replies and internal staff notes on a ticket.
- `ticket_events`: the audit log, one row per change to a ticket. A NULL actor means the system made the change.
- `schema_migrations`: which migration files have been applied.

### Two database roles

| Role | Used by | Can do |
| --- | --- | --- |
| `resolvd_owner` | migrations, seeds | Owns every table and function |
| `resolvd_app` | the running API | Read and write rows only, and only through row-level security |

Row-level security doesn't apply to a table's owner, so if the API connected as the owner, RLS would do nothing. The API therefore connects as `resolvd_app`, which owns nothing. This is also least privilege: `resolvd_app` can't create, alter or drop tables, read `schema_migrations`, or insert organizations. A bug or a stolen API connection can't damage the schema.

### Row-level security

Every tenant table has a policy named `org_isolation`: `organization_id = current_org_id()`, used both to filter rows (`USING`) and to check writes (`WITH CHECK`). `current_org_id()` reads the `app.current_org_id` setting, which the API's `withOrg()` helper sets with `set_config(..., true)` at the start of each transaction. The `true` makes it transaction-local, so it can't leak to the next request that reuses the pooled connection.

If the setting is missing, `current_org_id()` is NULL, `organization_id = NULL` is never true, and **no rows are visible**. Forgetting to set the org fails closed, not open. `organizations` has its own policy, `org_self` (`id = current_org_id()`), so an org can only see its own row. `docs/rls-demo.sql` demonstrates all of this.

This is the second layer of tenant isolation. The first is that every service query also scopes by the signed-in user's org.

### Composite foreign keys

Each tenant table has `UNIQUE (organization_id, id)`, and references to other tenant rows include the org: for example `FOREIGN KEY (organization_id, category_id) REFERENCES categories (organization_id, id)`. A plain `category_id` foreign key would accept another org's category id. The composite one makes the database reject any ticket, comment or event that points at a row in a different organization. With the default `MATCH SIMPLE`, a NULL `category_id`, `assignee_id` or `actor_id` skips the check, which allows uncategorized and unassigned tickets and system events.

### SECURITY DEFINER functions

These run with the owner's rights, so they bypass RLS. Each does one narrow job that can't work under RLS. All use `SET search_path = public` so a caller can't substitute look-alike objects, and only `resolvd_app` may execute them.

- `auth_find_user_by_email(email)`: login has to find the user before it knows their org, and with no org set RLS would hide every user. Returns only what login needs.
- `auth_record_login_failure(user_id, max_attempts, lock_minutes)`: adds 1 to the failure count and locks the account at the limit. It's called on its own rather than inside the login transaction, because that transaction rolls back when login fails and would undo the count.
- `create_organization(name, slug)`: during sign-up the new org doesn't exist yet, so there's no org to set, and `resolvd_app` has no INSERT permission on `organizations`.

### Indexes

Besides primary keys and unique constraints: `users_email_lower_idx` (case-insensitive unique email), and on `tickets` the indexes `(organization_id, status)` and `(organization_id, assignee_id)` for queue filters. There is also a **partial** index on `(organization_id, resolution_due_at)` covering only tickets that aren't resolved or closed, because only open work has a deadline to check, so the index stays small. Comments and events are indexed on `(ticket_id, created_at)` for the activity feed.

## Security

## Background jobs

## Front end

## Deployment
