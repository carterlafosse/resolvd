# CLAUDE.md: Rules for building Resolvd

Read this file at the start of every session. The full specification is in `RESOLVD_PLAN.md`. Read it fully before starting any phase, and re-read the section for the current phase before writing code.

## What this project is

Resolvd is a multi-organization IT helpdesk: a strong Express + PostgreSQL API with a React front end. It is Carter LaFosse's portfolio project for IT support, IT analyst and software developer roles. Carter must be able to explain every part of it in an interview, so clarity beats cleverness everywhere.

## How we work

1. **One phase at a time.** Build only the phase Carter names. When the phase's Definition of Done is met, stop and send the Phase Report (format below). Do not start the next phase until Carter says "continue".
2. **Commit as you go, never push.** Make a small commit after each working step, using the commit messages listed in the plan (adjust wording if the work differed). The last commit of each phase includes `Closes #N` with the issue number from the plan. **Never run `git push`, `git push --force`, or anything that writes to GitHub.** Carter reviews and pushes himself.
3. **Never rewrite history.** No `git rebase`, `git reset --hard`, `git commit --amend` on existing commits, or force operations. If something needs fixing, make a new commit.
4. **Verify before you claim.** Before saying a step works, run it: lint, tests, migrations, the server, or a request with `curl`. Report what you actually ran and what it printed. If you could not run something (for example, no database available), say so plainly instead of implying it passed.
5. **Double-check every phase.** Before the Phase Report, re-read the phase spec line by line and confirm each requirement is implemented and tested. List anything you skipped or changed, and why.
6. **Ask, don't guess, on real decisions.** If the plan is ambiguous, contradicts itself, or a choice can't easily be undone, stop and ask Carter. For small, reversible choices, decide, note it in `docs/DECISIONS.md`, and continue.
7. **Stay in scope.** Don't add features, libraries or files the plan doesn't call for. If you think something is missing, suggest it in the Phase Report instead.

## Files that belong to Carter

- **`docs/build-log.md`** is Carter's own writing. Never create, edit or rewrite it. You may remind him to update it.
- **`.env`, `.env.test`, `.env.production`** are never created with real secrets and never committed. Create `.env.example` files with placeholders only. When a step needs a real `.env`, tell Carter exactly which keys to set and let him fill in the values.
- **Screenshots** in `docs/screenshots/` are taken by Carter. Tell him when and what to capture.

## Secrets and safety

- Never write passwords, API keys, JWT secrets or connection strings with real credentials into any committed file, comment, test or doc. Use placeholders like `YOUR_APP_PASSWORD`.
- If you notice a secret in the repo or in a command Carter pasted, stop and tell him so he can rotate it.
- Never run destructive database commands (`DROP DATABASE`, `TRUNCATE` outside the seed and test scripts, `DELETE` without `WHERE`) against anything except the local dev and test databases, and only when the plan calls for it.
- Never connect to production databases (Neon, Render) yourself. Carter runs production commands.

## Stack (fixed; don't change without asking)

- Node.js 26 (installed via fnm), JavaScript with ES modules (`"type": "module"`). No TypeScript.
- Express 5, PostgreSQL 18 locally, raw SQL with `pg`. No ORM, no query builder.
- Own numbered migration runner (`server/scripts/migrate.js`, `schema_migrations` table).
- Zod for validation, `bcryptjs` (not `bcrypt`), `jsonwebtoken`, `cookie-parser`, `helmet`, `cors`, `express-rate-limit`, `pino` + `pino-http`, `node-cron`, `swagger-ui-express` + `yaml`.
- Tests: Vitest + Supertest against a real PostgreSQL test database. No mocking the database.
- Front end: React (Vite), React Router, Mantine, TanStack Query, `@tabler/icons-react`.
- Hosting: Render (API), Neon (Postgres), Vercel (front end with a rewrite proxying `/api` to Render).
- Windows development machine using PowerShell. Any command you give Carter must work in PowerShell.

## Code conventions

**Back end**
- Feature modules in `server/src/modules/<feature>/`, each with `<feature>.routes.js`, `.controller.js`, `.service.js`, `.queries.js`, `.schemas.js`.
- Layers: middleware → route (with `validate()`) → controller (no business logic) → service (business rules, opens `withOrg`) → queries (SQL only, take `client` as the first argument).
- Every query touching tenant data runs inside `withOrg(orgId, work)` using the `client` it provides, never `pool.query`.
- User input never goes into SQL text. Values go in parameters; column names come from whitelists.
- Errors: throw `AppError` (status, code, message, details). Responses are always `{ error: { code, message, details? } }`.
- Relative imports include the `.js` extension.
- Comment the *why*, not the *what*. Each file starts with a one-line comment saying what it's for.

**Front end**
- Every React component follows this structure: a header comment saying what the component does, then `// ----- State -----`, `// ----- Data -----`, `// ----- Handlers -----` and `// ----- Render -----` sections. Custom styles go in a CSS module beside the component (`TicketQueuePage.module.css`) with clear class names like `.queueHeader`. Mantine props handle most styling, so CSS modules stay small.
- All API calls go through `client/src/api/client.js`. Server state uses TanStack Query.

**Database**
- Every tenant table has `organization_id`, `UNIQUE (organization_id, id)`, composite foreign keys to other tenant tables, row-level security with the `org_isolation` policy, and grants to `resolvd_app`.
- Never edit a migration that has been committed. Fix with a new migration.

## Shared conventions with ScreenGuide AI

Carter's other project, ScreenGuide AI, was built to match Resolvd's conventions so the two can merge later. These names are fixed and must not change: the `user_role` enum (`end_user`, `technician`, `admin`); the `organizations` and `users` columns in the plan; `app.current_org_id`, `current_org_id()`, the `org_isolation` policy name; `auth_find_user_by_email` and `create_organization`; `set_updated_at()`; the `resolvd_token` cookie; the JWT payload `{ sub, org }`. If anything in the plan seems to need one of these changed, stop and ask.

## Phase Report format

At the end of every phase, send exactly this:

```
## Phase N report: <name>

**Built:** short list of what now exists
**Commits:** list of commit hashes and messages from this phase
**Verified:** each command you ran and its result (tests passed count, lint, migrations, manual requests)
**Not verified / needs Carter:** anything you couldn't run, and why
**Changes from the plan:** anything you did differently, and why (also in docs/DECISIONS.md)
**Carter's checks:** copy the "Carter's checks" list for this phase from the plan, adjusted to what was actually built
**Concept checks for the build log:** copy the questions for this phase from the plan
**Ready to push:** yes/no, and why
```

Then stop.
