// Shared test helpers: the app, signing in as a user, and creating test-only users directly in the DB.
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

// Importing the app loaded .env.test, so these are set.
export const SEED_PASSWORD = process.env.SEED_PASSWORD;
export const TEST_PASSWORD = 'Testpassw0rd';

export const app = createApp();

// Owner connection (bypasses RLS) for setting up and inspecting data the API can't reach.
export const ownerPool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  max: 2,
});

export async function closePools() {
  await Promise.all([pool.end(), ownerPool.end()]);
}

// The login route allows 10 attempts per IP per 15 minutes. The app trusts one proxy hop
// (Render in production), so X-Forwarded-For sets req.ip. Giving each sign-in its own fake
// address keeps tests from tripping the limiter, which has its own dedicated test.
let ipCounter = 0;
export function nextTestIp() {
  ipCounter += 1;
  return `10.99.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${randomUUID().slice(0, 8)}@test.test`;
}

export function login(email, password, ip = nextTestIp()) {
  return request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });
}

// A Supertest agent keeps cookies between requests, like a browser.
export async function loginAs(email, password = SEED_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('X-Forwarded-For', nextTestIp())
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`loginAs(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export async function orgIdBySlug(slug) {
  const { rows } = await ownerPool.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
  return rows[0].id;
}

// Test-only users, so tests that lock or deactivate accounts never touch the seed users.
// bcrypt cost 4 keeps this fast; login checks a hash of any cost.
export async function createUser({
  orgSlug = 'acme-corp',
  role = 'end_user',
  name = 'Test User',
  email = uniqueEmail(role),
  password = TEST_PASSWORD,
} = {}) {
  const orgId = await orgIdBySlug(orgSlug);
  const { rows } = await ownerPool.query(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, organization_id`,
    [orgId, name, email, await bcrypt.hash(password, 4), role],
  );
  return { ...rows[0], email, password };
}

export async function findUserRow(id) {
  const { rows } = await ownerPool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0];
}

// Signs up a brand-new organization through the API and returns an agent signed in as its
// admin. Tests that need predictable data (ticket numbers starting at 1001, an empty queue)
// use their own org instead of the shared seed orgs.
export async function registerOrg() {
  const tag = randomUUID().slice(0, 8);
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register-organization')
    .set('X-Forwarded-For', nextTestIp())
    .send({
      organizationName: `Test Org ${tag}`,
      slug: `test-org-${tag}`,
      name: 'Org Admin',
      email: uniqueEmail('admin'),
      password: TEST_PASSWORD,
    });
  if (res.status !== 201) {
    throw new Error(`registerOrg failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { agent, admin: res.body.user, org: res.body.organization };
}

// ----- Ticket helpers (used by the ticket, workflow and comment suites) -----

// A fresh org with an admin, a technician and two end users, all signed in.
export async function setUpOrg() {
  const { agent: admin, admin: adminUser, org } = await registerOrg();
  const [techUser, aliceUser, bobUser] = await Promise.all([
    createUser({ orgSlug: org.slug, role: 'technician', name: 'Tess Tech' }),
    createUser({ orgSlug: org.slug, role: 'end_user', name: 'Alice User' }),
    createUser({ orgSlug: org.slug, role: 'end_user', name: 'Bob User' }),
  ]);
  const [tech, alice, bob] = await Promise.all(
    [techUser, aliceUser, bobUser].map((u) => loginAs(u.email, u.password)),
  );
  const categories = (await admin.get('/api/categories')).body.data;
  const categoryId = (name) => categories.find((c) => c.name === name).id;
  return { org, admin, adminUser, tech, techUser, alice, aliceUser, bob, bobUser, categoryId };
}

let counter = 0;
export function ticketBody(overrides = {}) {
  counter += 1;
  return {
    title: `Test ticket ${counter}`,
    description: 'Something is not working as expected.',
    ...overrides,
  };
}

export async function createTicket(agent, overrides) {
  const res = await agent.post('/api/tickets').send(ticketBody(overrides));
  if (res.status !== 201) {
    throw new Error(`createTicket failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

// Sets ticket columns directly (owner connection), for states the API would need many steps
// to reach, such as a ticket resolved eight days ago or a deadline in the past.
export async function setTicketColumns(ticketId, columns) {
  const entries = Object.entries(columns);
  const sets = entries.map(([column], i) => `${column} = $${i + 2}`).join(', ');
  await ownerPool.query(`UPDATE tickets SET ${sets} WHERE id = $1`, [
    ticketId,
    ...entries.map(([, value]) => value),
  ]);
}

export async function eventsFor(ticketId) {
  const { rows } = await ownerPool.query(
    `SELECT actor_id, field, old_value, new_value FROM ticket_events
     WHERE ticket_id = $1 ORDER BY id`,
    [ticketId],
  );
  return rows;
}
