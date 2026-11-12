# Resolvd Build Log

## 2026-11-07 (Phase 0, steps 0.1 to 0.6)

**Did:**
- Installed Node.js (with fnm), PostgreSQL with pgAdmin, the PostgreSQL VS Code extension and Bruno
- Created a private `resolvd` repo on GitHub and connected to my `C:\Projects\resolvd` folder
- Set Git's default branch to `main` and configured my name and email on this PC
- Created the full project folder structure
- Wrote `.gitignore`, a placeholder README and this build log
- Initialized the server package and installed dependencies
- Created the phase issues (#2 to #12) and the v1.0 MVP, v2 and v3 milestones
- Switched to building with Claude Code from my own plan (CLAUDE.md and RESOLVD_PLAN.md); I review and push each phase myself
- Claude Code verified my setup, caught a typo in the `migrate` script and added `.gitattributes`, lint/format config and `.env.example`

**Problems:**
- `fnm` wasn't recognized right after installing. The installer updated PATH, but the open PowerShell window still had the old PATH, so a new window fixed it
- `psql` wasn't recognized, so I added `C:\Program Files\PostgreSQL\18\bin` to my user PATH
- My first `.gitignore` used `*.env`, which wouldn't have caught `.env.test`. Switched to `.env` plus `.env.*`, then un-ignored `.env.example`
- Issue #1 was taken by a deleted issue, so phase issues start at #2 and the first `Closes #1` didn’t close anything

**Learned:**
- Terminals only read PATH when they open, so any PATH change will always need a fresh window
- `.gitignore` rules are read top to bottom, so a `!` exception has to come after the rule it overrides
- Test ignore rules with a dummy file and `git status` rather than just assuming they work

**Concept check:**
- What does `"type": "module"` change?
    - It switches Node from CommonJS (`require`) to ES modules (`import`/`export`), the modern JavaScript standard, so relative imports need the `.js` extension
- Why is `.env` ignored by Git but `.env.example` committed?
    - In `.gitignore`, `.env` is specifically mentioned as a file to ignore, as well as `.env.*`. After those two lines `.env.example` is explicitly un-ignored. `.env` holds real secrets (database passwords, the JWT secret), and committing it to a public repo would expose them to anyone. `.env.example` has the same variable names with placeholder values, so anyone cloning the repo knows what to set up without seeing the actual secrets.
- What does `.gitattributes` fix on Windows?
    - It tells Git to store text files with LF line endings no matter which OS saved them. That stops the CRLF warnings and prevents diffs where every line looks changed just because of line endings

**Next:**
- Phase 1: database roles, migrations, row-level security and seed data (issue #3)

## 2026-11-11 (Phase 1: database, migrations and row-level security)

**Did:**
- Claude Code built the setup script, migration runner, migrations 001 to 007, seed script and RLS demo. It tested everything on a temporary PostgreSQL 18 cluster first, so my real server wasn't touched until I ran it
- Ran the setup myself to create the `resolvd_owner` and `resolvd_app` roles and the `resolvd_dev` and `resolvd_test` databases
- Filled in `server/.env` with real values (never committed)
- Ran the migrations twice (the second run correctly applied nothing) and seeded Acme Corp and Globex
- Ran the RLS demo as `resolvd_app` and took the screenshot
- Ran a compatibility check between Resolvd and ScreenGuide AI's shared tables

**Problems:**
- The setup command contains real passwords, so I cleared it from PowerShell history afterwards
- The first ScreenGuide compatibility check ran before Phase 1 was pushed, so it compared against the plan instead of the real migrations. I'm re-running it against the real code

**Learned:**
- Migrations are numbered SQL files, and a `schema_migrations` table records which have run, so every database ends up with the same schema
- Each migration and its tracking row commit in one transaction, so a failed migration is never recorded as done
- Row-level security makes PostgreSQL itself filter rows by organization, as a second layer behind the app's own checks

**Concept checks:**
- Why does the app connect as `resolvd_app` and not the table owner?
    - RLS doesn't apply to a table's owner, so if the API connected as the owner, every policy would be silently skipped. It's also least privilege: if the API were ever compromised, it couldn't drop or change tables
- What happens if `app.current_org_id` is never set?
    - `current_org_id()` returns NULL, so no row's `organization_id` matches and no rows are visible at all. It fails safe instead of showing everything
- What problem does the composite foreign key on `category_id` prevent?
    - A normal foreign key only checks the category exists somewhere. The composite key on `(organization_id, category_id)` checks it exists in the same organization, so an Acme ticket can't point at a Globex category
- Why is the tickets due-date index partial?
    - It only covers tickets that aren't resolved or closed, which are the only ones the SLA checker searches. It stays small and fast even as closed tickets pile up

**Next:**
- Phase 2: Express server foundation (issue #4)

## 2026-11-11 (Phase 2: Express server foundation)

**Did:**
- Claude Code built the Express foundation: validated config, pino logging, the database pool and `withOrg` transaction helpers, `AppError` and the error handler, security middleware, graceful shutdown, the health check and Swagger docs
- Asked it to match ScreenGuide AI's error handling so the two stay compatible: body-parser errors (`INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`), ten `AppError` helpers, and Zod 4's `z.flattenError` for validation details
- Created `server/.env.test` for the `resolvd_test` database
- Checked by hand: `/api/health` returned 200, then 503 with PostgreSQL stopped; Swagger UI loaded at `/api/docs`; removing `JWT_SECRET` gave a clear startup error; Ctrl+C logged "Shutting down"
- Ran lint and all 29 tests, and took two Swagger screenshots

**Problems:**
- 6 tests failed with "password authentication failed for user resolvd_app". The password in `.env.test` didn't match the real one. Copying it exactly from `.env` fixed it
- I accidentally edited `.env.test.example` (the committed placeholder file) instead of `.env.test`. `git diff` caught it before committing, and `git restore` put it back

**Learned:**
- When many tests fail at once, look for one shared cause. Here every database test failed and every non-database test passed
- Always check `git status` and `git diff` before committing; it caught my mistake
- Validating config at startup means a bad `.env` fails immediately with a clear message, instead of a confusing crash later

**Concept checks:**
- Why must every query inside `withOrg` use `client` instead of `pool`?
    - `withOrg` runs one transaction on one connection and sets `app.current_org_id` on it. `pool.query` could use a different connection, which would run outside the transaction and without the org setting, so RLS would hide everything and a rollback wouldn't undo it
- Why does the error handler need four parameters?
    - Express recognizes error-handling middleware by its four parameters `(err, req, res, next)`. With three, Express treats it as normal middleware and never sends errors to it
- Why are raw database errors never sent to the client?
    - They can reveal table names, column names and internal details an attacker could use. The full error goes to the server log, and the client gets a safe message and code
- What does `trust proxy` change?
    - On Render, requests arrive through a proxy, so Express would see the proxy's IP for every user. `trust proxy` tells Express to read the real client IP from the proxy's headers, so rate limiting works per user instead of treating everyone as one

**Next:**
- Phase 3: authentication, roles and admin endpoints (issue #5)

## 2026-11-12 (Phase 3: authentication, roles and admin endpoints)

**Did:**
- Claude Code built organization sign-up, login with account lockout, cookie sessions, `/me` and logout, role checks, and the users and categories admin endpoints, with 59 new tests (88 total)
- Tested it by hand in Bruno: registered an org, logged in, called `/me`, logged out (401 afterwards), triggered the lockout, and got a 403 listing users as an end user
- Confirmed the lockout in pgAdmin by checking `locked_until`

**Problems:**
- My first lockout test didn't lock anything because I wrapped the email in curly braces (`{carter@test.local}`). The API treated it as an unknown email, so no account was counted. That's actually the identical-response design working
- I hit the 10-per-IP login rate limit (429) during testing. Restarting the dev server reset it, since the limiter lives in memory

**Learned:**
- Lockout (per account, 5 tries) and rate limiting (per IP, 10 tries) are separate protections against different attacks
- Locking only one row can't stop two admins demoting each other at the same time, so the last-admin check locks every admin row in a fixed order
- Claude Code proved that lock works by removing it, watching the test fail, then restoring it

**Concept checks:**
- Why is the session in an httpOnly cookie instead of localStorage?
    - JavaScript can't read an httpOnly cookie, so if a cross-site scripting bug ever got into the page, the attacker's script couldn't steal the session. Anything in localStorage can be read by any script on the page
- Why does `authenticate` load the user from the database on every request?
    - So changes take effect immediately. If the role or active status came from the token, a deactivated or demoted user would keep their access until the token expired, up to 8 hours
- Why do "unknown email" and "wrong password" return the same response?
    - Different messages would let an attacker find out which emails have accounts. The dummy password check also makes both cases take the same time, so they can't be told apart by timing
- Why would the failed-attempt counter be lost if it were updated inside the same transaction that throws the login error?
    - Throwing the 401 inside the transaction triggers a rollback, which undoes every change in it, including the counter update. The counter never goes up and the account never locks. Running the update as its own statement saves it before the error is thrown

**Next:**
- Phase 4: tickets API (issue #6)

## 2026-11-12 (Phase 4: tickets API)

**Did:**
- Claude Code built the tickets API: create, list (filters, search, sorting, pagination), get and update, with per-org ticket numbers, role-based visibility, change events and optimistic locking (227 tests total)
- It also applied three follow-ups from the ScreenGuide compatibility check: `setOrg` rejects invalid org ids, sign-up is limited to 5 per hour per IP, and a wrong comment in `AppError.js` was fixed
- I asked it to fix a bug it found: very large ids like `/api/users/99999999999` returned a 500. It wrote failing tests first, then fixed it with one shared id schema used by every module
- Tested in Bruno: created RES-1001 and RES-1002 as a technician, tried filters, search and pagination, and confirmed an end user gets a 404 for a ticket they didn't create

**Problems:**
- Bruno saved my edited Login request into the collection file. `git status` caught it before committing, and `git restore` put it back. From now on I'll change accounts through the environment variables instead of the request body

**Learned:**
- A huge number in a URL can crash a query if it's bigger than the database's INT type, so ids need an upper limit in validation, not just "positive integer"
- Writing the test first and watching it fail proves the bug is real and that the fix is what solved it
- Bruno variables (`{{email}}`, `{{password}}`) keep requests reusable and keep secrets out of committed files

**Concept checks:**
- How does the list query stay safe from SQL injection when the SQL is built dynamically?
    - User input never goes into the SQL text. Every value goes into a parameter array and is sent separately as `$1`, `$2` and so on, so the database treats it as data, never as SQL. Sort columns can't be parameters, so they come from a whitelist, and anything else fails validation with a 400
- Why 404 instead of 403 for someone else's ticket?
    - A 403 would confirm the ticket exists, so someone could probe ticket ids to learn about other people's tickets. A 404 gives away nothing
- Why claim ticket numbers with one `UPDATE ... RETURNING` instead of `SELECT` then `UPDATE`?
    - With two steps, two requests at the same moment could both read the same number and create duplicates. A single `UPDATE` locks the organization's row until the transaction commits, so the second request waits and gets the next number. Creating 5 tickets in parallel gave 1001 to 1005 with no duplicates
- What does `COUNT(*) OVER()` give you?
    - It's a window function that adds the total number of matching rows to every row, before `LIMIT` cuts it down to one page. One query gives both the page of tickets and the total needed for pagination

**Next:**
- Phase 5: workflow, assignment, comments and audit log (issue #7)

## 2026-11-12 (Phase 5: workflow, assignment, comments and audit log)

**Did:**
- Claude Code built the status workflow, assignment and priority changes, comments with internal notes, first-response tracking, the event history and a combined activity feed (360 tests total)
- Tested the full helpdesk flow in Bruno:
    - As an end user (Erin), reported a VPN ticket
    - As a technician (Taylor), assigned it to myself (it moved to in progress automatically) and added an internal note and a public reply
    - As Erin, saw only the public reply. The internal note and the assignment event were hidden in both the comments and the activity feed
    - Tried moving a new ticket straight from open to closed and got 400 `INVALID_TRANSITION`

**Problems:**
- One Create ticket request in Bruno said "request failed". The server log showed "request aborted": Bruno dropped the connection, not the server. The ticket was likely still created, leaving a duplicate after I retried. This is the retry problem that idempotency keys solve, which Phase 14 uses for the ScreenGuide integration
- An end user can only see tickets they created, so for the comment test the end user had to create the ticket, not the technician

**Learned:**
- Switching accounts by changing the `email` variable in the Bruno environment keeps the request files untouched
- Automatic status changes (assigning a ticket, or a requester replying to an on-hold one) are recorded under the person who caused them, so the audit trail always shows who was responsible
- Gaps in ids (like event 5 missing from Erin's view) are a quick visual check that filtering is working

**Concept checks:**
- What does `SELECT ... FOR UPDATE` protect against?
    - Two requests changing the same ticket at the same moment. Without it, both read the old status, both pass the workflow check, and the audit log records changes that don't line up. `FOR UPDATE` locks the row, so the second request waits for the first to commit and then sees the new status
- Why filter internal notes in SQL rather than in JavaScript?
    - If the query never returns the notes, they can't leak by mistake: a forgotten filter, a new endpoint, or a front-end bug can't expose data the server never sent. Filtering in JavaScript means the data is already loaded and one missed check exposes it
- Why keep the workflow rules in pure functions?
    - No database or Express is involved, so every combination of status and role can be tested in milliseconds (92 unit tests), and the rules live in one place. Changing a rule, like the 7-day reopen window, means changing one function
- Why store names rather than ids in assignment events?
    - The history reads clearly ("Unassigned → Taylor Tech") without looking anything up, and it stays accurate as a historical record even if that user is later renamed or deactivated

**Next:**
- Phase 6: SLAs and the breach-checking job (issue #8)

## 2026-11-12 (Phase 6: SLAs and the breach-checking job)

**Did:**
- Claude Code built SLA tracking: response and resolution deadlines set from each ticket's priority, a live SLA state on every ticket (on track, at risk, breached, met), `sla=breached` and `sla=at_risk` queue filters, admin-editable SLA policies, and a background job that records breaches every 5 minutes (413 tests total)
- Ran migration 008 and checked the server log showed "SLA checker scheduled every 5 minutes"
- Created a critical ticket in Bruno and confirmed its deadlines were exactly +1 hour (response) and +4 hours (resolution)
- Tested SLA policies: a technician got 403 trying to update them; as an admin I changed critical to 30/240 and set it back to 60/240
- Forced a breach by setting a ticket's resolution deadline 10 minutes in the past with `psql`. At the next 5-minute mark the log showed "SLA check recorded 1 breach(es)", and `ticket_events` had one `sla_breach` row with no actor (the system). After the next run there was still only one row

**Problems:**
- None this phase. Tickets created before migration 008 have no deadlines, so their SLA shows `none`. That's expected, not a bug

**Learned:**
- An SLA is a promise about how fast IT responds to and resolves a problem, based on priority. A breach is a missed deadline, and helpdesks track compliance as a key metric
- A background job can find problems on its own instead of waiting for someone to load a page
- Claude Code made resolving a ticket count as the first response, so a ticket fixed without a comment doesn't get flagged for a missed response

**Concept checks:**
- Why store deadlines on the ticket instead of calculating from the current policy?
    - So changing a policy doesn't rewrite history. If an admin shortens the critical deadline today, tickets created last week keep the deadlines they were given, and past SLA reports stay accurate
- What does idempotent mean, and why does the breach job need it?
    - Running it once or many times has the same result. The job runs every 5 minutes, so it must not record the same breach again each time. It only marks tickets whose breach column is still empty, which I confirmed: one `sla_breach` row even after a second run
- Why does the job use a SECURITY DEFINER function?
    - The job runs with no logged-in user, so there's no organization set, and row-level security would hide every ticket. A narrow SECURITY DEFINER function runs with the owner's rights to do exactly one job (mark breaches across all organizations) and nothing else, and only `resolvd_app` can call it

**Next:**
- Phase 7: front end foundation (issue #9)

## 2026-11-12 (Phase 7: front end foundation)

**Did:**
- Claude Code built the React front end: Vite, Mantine (indigo theme with light and dark mode), React Router and TanStack Query, plus sign-in and sign-up pages, route guards, and an app shell with navigation, a user menu and a mobile burger menu (27 client tests)
- Ran the API and the front end together for the first time, in two terminals
- Checked in the browser:
    - signed in as an end user, technician and admin; only the admin sees the Admin section
    - stayed signed in after a refresh
    - got a friendly no-access page visiting `/admin/users` as an end user
    - registered an org; the URL name filled in automatically, and a taken name showed its error under that field
    - checked dark mode and phone width
- Checked that `LoginPage.jsx` follows my component structure (header comment, then State, Data, Handlers and Render)
- Ran lint, tests and a production build, and took the sign-in screenshot

**Problems:**
- Ran `npm run build` in `server` by mistake. Only the client has a build step, because Vite bundles the React code for the browser and the server runs Node directly
- Spotted one inline style in `LoginPage.jsx`. My convention is CSS modules beside the component, so I'll have it fixed in Phase 8

**Learned:**
- The front end and the API are separate apps. The React app calls the same endpoints I tested in Bruno
- Vite warns about bundles over 500 kB. Mine is 175 kB gzipped, which loads fine, and code-splitting can shrink it later

**Concept checks:**
- Why does the Vite proxy matter for cookies?
    - The front end runs on port 5173 and the API on 4000, which the browser treats as different sites, so it limits cross-site cookies. The proxy forwards `/api` requests from 5173 to 4000, so the browser only ever talks to one origin and the login cookie works normally. In production, a Vercel rewrite does the same job
- What does TanStack Query handle that `useEffect` fetching doesn't?
    - Caching, loading and error states, retries, and refetching. It also keeps every component showing the same data in sync. With `useEffect`, I'd write all of that by hand in every component
- Why aren't front-end route guards real security?
    - Anyone can change the JavaScript running in their own browser, or skip the front end and call the API directly (like I did with Bruno). The guards only decide what pages to show. The real security is the API's `authenticate` and `requireRole` checks and row-level security in the database

**Next:**
- Phase 8: ticket pages and admin screens (issue #10)

## 2026-11-12 (Phase 8: ticket pages and admin screens)

**Did:**
- Claude Code built the real helpdesk screens:
    - a ticket queue with role-based tabs, filters in the URL, search, sortable columns, pagination, and a card layout on phones
    - a new ticket form with priority help text (critical only for staff)
    - a ticket page with an activity feed, inline editing, status, priority and assignee controls, and both SLA clocks
    - admin pages for users, categories and SLA policies
    - 426 server and 74 client tests
- Saw the app as real web pages for the first time and walked the full flow:
    - as Erin (end user), submitted RES-1009 "Outlook can't sign in"
    - as Taylor (technician), found it under Unassigned, assigned it to myself, added an internal note and a public reply, and resolved it
    - as Erin, saw the reply but not the note, and clicked "Yes, it's fixed"
    - as an admin, added a technician, edited an SLA policy and renamed a category
- Signed in as Acme and Globex admins side by side (one window in Incognito), and neither saw the other's data
- Took the main screenshots in light mode, plus dark mode and phone width, using Chrome's Capture screenshot so they show just the page

**Problems:**
- None in the app. I retook the Phase 7 sign-in screenshot in light mode so all the README screenshots match

**Learned:**
- The page uses `allowedTransitions` and `canEdit` from the API to decide which buttons to show, so an end user on an open ticket sees Edit but no status control
- Incognito windows have separate cookies, which makes testing two accounts at once easy
- Chrome dev tools can take clean screenshots of just the page, including at phone sizes

**Concept checks:**
- Why do filters live in the URL?
    - A filtered view can be bookmarked, shared or refreshed without losing it, and the back button works between filter changes. It also means there's one source of truth for what the page is showing
- Why does the API send `allowedTransitions` instead of the front end working them out?
    - The server already has the workflow rules, so it stays the single source of truth. If the front end copied them, the two could drift apart and show buttons that the API would then refuse. The UI just reflects what the server will allow
- What does `invalidateQueries` do after a mutation?
    - It marks the cached data for those queries as out of date, so TanStack Query refetches it. After I resolved the ticket, the ticket page and the queue both refreshed to show the new status without reloading the page

**Next:**
- Phase 9: test infrastructure, isolation suite and CI (issue #11)