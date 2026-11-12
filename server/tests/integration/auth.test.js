// Auth: organization sign-up, login with lockout and rate limiting, sessions, /me and logout.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import {
  app,
  closePools,
  createUser,
  findUserRow,
  login,
  loginAs,
  nextTestIp,
  ownerPool,
  SEED_PASSWORD,
  uniqueEmail,
} from '../helpers.js';

afterAll(closePools);

function signUpBody(overrides = {}) {
  const tag = randomUUID().slice(0, 8);
  return {
    organizationName: `Test Org ${tag}`,
    slug: `test-org-${tag}`,
    name: 'First Admin',
    email: uniqueEmail('founder'),
    password: 'Founderpass1',
    ...overrides,
  };
}

const sessionCookie = (res) =>
  res.headers['set-cookie']?.find((c) => c.startsWith('resolvd_token='));

describe('POST /api/auth/register-organization', () => {
  it('creates the org, its admin and default categories and SLA policies, and signs in', async () => {
    const agent = request.agent(app);
    const body = signUpBody({ email: '  Founder.MIXED@Test.test ' });

    const res = await agent
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'First Admin', role: 'admin', is_active: true });
    expect(res.body.user.email).toBe('founder.mixed@test.test');
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.organization).toMatchObject({ name: body.organizationName, slug: body.slug });
    expect(sessionCookie(res)).toMatch(/HttpOnly/);

    // The cookie works straight away, and the defaults exist in the new org.
    const categories = await agent.get('/api/categories');
    expect(categories.body.data).toHaveLength(6);
    const { rows } = await ownerPool.query(
      'SELECT count(*)::int AS n FROM sla_policies WHERE organization_id = $1',
      [res.body.organization.id],
    );
    expect(rows[0].n).toBe(4);
  });

  it('ignores a role sent in the body (the first user is always the admin)', async () => {
    const res = await request(app)
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send({ ...signUpBody(), role: 'end_user' });

    expect(res.body.user.role).toBe('admin');
  });

  it('rejects an email that is already registered with 409 and leaves no org behind', async () => {
    const body = signUpBody({ email: USERS.acme.admin.email.toUpperCase() });

    const res = await request(app)
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('That email is already registered');
    expect(res.body.error.details.fieldErrors.email).toBeDefined();
    const { rows } = await ownerPool.query('SELECT 1 FROM organizations WHERE slug = $1', [
      body.slug,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('rejects a slug that is taken with 409', async () => {
    const res = await request(app)
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send(signUpBody({ slug: 'acme-corp' }));

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('That URL name is taken');
  });

  it.each([
    ['too short', 'Short1'],
    ['no number', 'nonumbershere'],
    ['no letter', '12345678901'],
    ['over 72 bytes', `${'é'.repeat(40)}1`],
  ])('rejects a weak password (%s)', async (_, password) => {
    const res = await request(app)
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send(signUpBody({ password }));

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.password).toBeDefined();
  });

  it('limits one IP to 5 sign-up attempts per hour, in the standard error shape', async () => {
    const ip = nextTestIp();
    const statuses = [];
    let last;
    for (let i = 0; i < 6; i += 1) {
      // Invalid bodies: the limiter counts every attempt, and no orgs pile up in the test DB.
      last = await request(app)
        .post('/api/auth/register-organization')
        .set('X-Forwarded-For', ip)
        .send({});
      statuses.push(last.status);
    }

    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(400));
    expect(statuses[5]).toBe(429);
    expect(last.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many sign-up attempts. Try again in an hour.',
      },
    });

    // Another IP is unaffected.
    const other = await request(app)
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send({});
    expect(other.status).toBe(400);
  });

  it('rejects a slug with invalid characters', async () => {
    const res = await request(app)
      .post('/api/auth/register-organization')
      .set('X-Forwarded-For', nextTestIp())
      .send(signUpBody({ slug: 'Not Valid!' }));

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.slug).toBeDefined();
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with an HttpOnly, SameSite=Lax session cookie', async () => {
    const res = await login(USERS.acme.tech1.email, SEED_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(USERS.acme.tech1.email);
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.organization.slug).toBe('acme-corp');
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  it('matches the email ignoring case and surrounding spaces', async () => {
    const res = await login(`  ${USERS.acme.tech2.email.toUpperCase()} `, SEED_PASSWORD);

    expect(res.status).toBe(200);
  });

  it('gives a wrong password and an unknown email the identical response', async () => {
    const wrongPassword = await login(USERS.acme.user3.email, 'Wrongpassword1');
    const unknownEmail = await login('nobody@nowhere.test', 'Wrongpassword1');

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
  });

  it('refuses an inactive user with the same response', async () => {
    const user = await createUser();
    await ownerPool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const res = await login(user.email, user.password);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('saves a failed attempt even though the request fails', async () => {
    const user = await createUser();

    await login(user.email, 'Wrongpassword1');

    expect((await findUserRow(user.id)).failed_login_attempts).toBe(1);
  });

  it('locks the account after 5 failures and then refuses the right password', async () => {
    const user = await createUser();
    const ip = nextTestIp();

    for (let i = 0; i < 5; i += 1) {
      const res = await login(user.email, 'Wrongpassword1', ip);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const row = await findUserRow(user.id);
    expect(row.locked_until.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(row.failed_login_attempts).toBe(0);

    const res = await login(user.email, user.password, ip);
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'ACCOUNT_LOCKED',
      message: 'Account temporarily locked. Try again later.',
    });
  });

  it('lets the user in once the lock has expired, and clears the lockout fields', async () => {
    const user = await createUser();
    await ownerPool.query(
      `UPDATE users SET locked_until = NOW() - INTERVAL '1 minute', failed_login_attempts = 3
       WHERE id = $1`,
      [user.id],
    );

    const res = await login(user.email, user.password);

    expect(res.status).toBe(200);
    const row = await findUserRow(user.id);
    expect(row).toMatchObject({ locked_until: null, failed_login_attempts: 0 });
    expect(row.last_login_at).not.toBeNull();
  });

  it('returns 400 when the email or password is missing', async () => {
    const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextTestIp());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('limits one IP to 10 login attempts per 15 minutes', async () => {
    const ip = nextTestIp();
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await login('nobody@nowhere.test', 'Wrongpassword1', ip)).status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });
});

describe('sessions', () => {
  it('GET /me without a cookie is 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /me with a tampered cookie is 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'resolvd_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEsIm9yZyI6Mn0.forged');

    expect(res.status).toBe(401);
  });

  it('GET /me returns the user and their organization', async () => {
    const agent = await loginAs(USERS.globex.user1.email);

    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: USERS.globex.user1.email, role: 'end_user' });
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.organization).toMatchObject({ name: 'Globex', slug: 'globex' });
  });

  it('logout clears the cookie and the session stops working', async () => {
    const agent = await loginAs(USERS.acme.user2.email);

    const res = await agent.post('/api/auth/logout');

    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it("stops a deactivated user's existing cookie from working", async () => {
    const user = await createUser();
    const agent = await loginAs(user.email, user.password);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const admin = await loginAs(USERS.acme.admin.email);
    await admin.patch(`/api/users/${user.id}`).send({ isActive: false }).expect(200);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('applies a role change on the next request (the role is never read from the token)', async () => {
    const tech = await createUser({ role: 'technician' });
    const agent = await loginAs(tech.email, tech.password);
    expect((await agent.get('/api/users')).status).toBe(200);

    const admin = await loginAs(USERS.acme.admin.email);
    await admin.patch(`/api/users/${tech.id}`).send({ role: 'end_user' }).expect(200);

    expect((await agent.get('/api/users')).status).toBe(403);
  });
});
