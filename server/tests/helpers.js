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
