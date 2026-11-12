// Users endpoints: role-based listing, admin create/edit, admin protection rules and PATCH /me.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import * as usersService from '../../src/modules/users/users.service.js';
import {
  app,
  closePools,
  createUser,
  login,
  loginAs,
  nextTestIp,
  ownerPool,
  SEED_PASSWORD,
  uniqueEmail,
} from '../helpers.js';

afterAll(closePools);

describe('GET /api/users', () => {
  it('is 403 for an end user', async () => {
    const agent = await loginAs(USERS.acme.user1.email);

    const res = await agent.get('/api/users');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('gives technicians only id, name and role', async () => {
    const agent = await loginAs(USERS.acme.tech1.email);

    const res = await agent.get('/api/users');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(6);
    for (const user of res.body.data) {
      expect(Object.keys(user).sort()).toEqual(['id', 'name', 'role']);
    }
  });

  it('gives admins full details but never the password hash, only for their own org', async () => {
    const agent = await loginAs(USERS.globex.admin.email);

    const res = await agent.get('/api/users');

    const emails = res.body.data.map((u) => u.email);
    expect(emails).toContain(USERS.globex.tech1.email);
    expect(emails.every((e) => !e.endsWith('@acme.test'))).toBe(true);
    for (const user of res.body.data) {
      expect(user).not.toHaveProperty('password_hash');
      expect(user).toHaveProperty('last_login_at');
    }
  });

  it('filters by role and active', async () => {
    const agent = await loginAs(USERS.globex.admin.email);

    const techs = await agent.get('/api/users?role=technician&active=true');
    const inactive = await agent.get('/api/users?active=false');

    expect(techs.body.data.map((u) => u.role)).toEqual(['technician', 'technician']);
    expect(inactive.body.data.every((u) => u.is_active === false)).toBe(true);
  });

  it('rejects an invalid filter with 400', async () => {
    const agent = await loginAs(USERS.globex.admin.email);

    expect((await agent.get('/api/users?role=superuser')).status).toBe(400);
  });
});

describe('POST /api/users', () => {
  const newUser = () => ({
    name: 'New Hire',
    email: uniqueEmail('hire'),
    role: 'technician',
    department: 'IT',
    password: 'Temporary1pass',
  });

  it('lets an admin create a user who can then sign in', async () => {
    const admin = await loginAs(USERS.acme.admin.email);
    const body = newUser();

    const res = await admin.post('/api/users').send({ ...body, organization_id: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'New Hire', role: 'technician', department: 'IT' });
    expect(res.body).not.toHaveProperty('password_hash');
    // organization_id in the body is ignored: the user lands in the admin's org.
    expect(res.body.organization_id).toBe((await admin.get('/api/auth/me')).body.organization.id);
    expect((await login(body.email, body.password)).status).toBe(200);
  });

  it('rejects a duplicate email (any case, any org) with 409', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    const res = await admin
      .post('/api/users')
      .send({ ...newUser(), email: USERS.globex.user2.email.toUpperCase() });

    expect(res.status).toBe(409);
    expect(res.body.error.details.fieldErrors.email).toBeDefined();
  });

  it('is 403 for a technician', async () => {
    const tech = await loginAs(USERS.acme.tech1.email);

    expect((await tech.post('/api/users').send(newUser())).status).toBe(403);
  });
});

describe('PATCH /api/users/:id', () => {
  it('lets an admin change name, role, department and active status', async () => {
    const user = await createUser();
    const admin = await loginAs(USERS.acme.admin.email);

    const res = await admin
      .patch(`/api/users/${user.id}`)
      .send({ name: 'Renamed', role: 'technician', department: 'Ops', isActive: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Renamed',
      role: 'technician',
      department: 'Ops',
      is_active: false,
    });
  });

  it("is 404 when a Globex admin targets an Acme user's id", async () => {
    const acmeUser = await createUser({ orgSlug: 'acme-corp' });
    const globexAdmin = await loginAs(USERS.globex.admin.email);

    const res = await globexAdmin.patch(`/api/users/${acmeUser.id}`).send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    const { rows } = await ownerPool.query('SELECT name FROM users WHERE id = $1', [acmeUser.id]);
    expect(rows[0].name).toBe('Test User');
  });

  it('is 404 for an id that does not exist and 400 for one that is not a number', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    expect((await admin.patch('/api/users/999999').send({ name: 'X' })).status).toBe(404);
    expect((await admin.patch('/api/users/abc').send({ name: 'X' })).status).toBe(400);
  });

  it('requires at least one field', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    expect((await admin.patch(`/api/users/${(await createUser()).id}`).send({})).status).toBe(400);
  });

  it.each([
    ['demote', { role: 'technician' }],
    ['deactivate', { isActive: false }],
  ])("won't let an admin %s themselves", async (_, change) => {
    const self = await createUser({ role: 'admin' });
    const agent = await loginAs(self.email, self.password);

    const res = await agent.patch(`/api/users/${self.id}`).send(change);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_CHANGE_SELF');
  });

  describe('last active admin', () => {
    // A fresh org whose only admins are A and B, each signed in.
    async function orgWithTwoAdmins() {
      const tag = randomUUID().slice(0, 8);
      const agentA = request.agent(app);
      const signUp = await agentA
        .post('/api/auth/register-organization')
        .set('X-Forwarded-For', nextTestIp())
        .send({
          organizationName: `Race ${tag}`,
          slug: `race-${tag}`,
          name: 'Admin A',
          email: uniqueEmail('a'),
          password: 'Adminpass123',
        });
      const emailB = uniqueEmail('b');
      const created = await agentA
        .post('/api/users')
        .send({ name: 'Admin B', email: emailB, role: 'admin', password: 'Adminpass123' });
      const orgId = signUp.body.organization.id;
      return {
        orgId,
        a: { id: signUp.body.user.id, orgId, role: 'admin', agent: agentA },
        b: {
          id: created.body.id,
          orgId,
          role: 'admin',
          agent: await loginAs(emailB, 'Adminpass123'),
        },
      };
    }

    async function activeAdminCount(orgId) {
      const { rows } = await ownerPool.query(
        `SELECT count(*)::int AS n FROM users
         WHERE organization_id = $1 AND role = 'admin' AND is_active`,
        [orgId],
      );
      return rows[0].n;
    }

    it('lets one admin demote the other while another active admin remains', async () => {
      const { orgId, a, b } = await orgWithTwoAdmins();

      const res = await a.agent.patch(`/api/users/${b.id}`).send({ role: 'technician' });

      expect(res.status).toBe(200);
      expect(await activeAdminCount(orgId)).toBe(1);
    });

    it('never leaves zero admins when two admins demote each other at once (HTTP)', async () => {
      const { orgId, a, b } = await orgWithTwoAdmins();

      const results = await Promise.all([
        a.agent.patch(`/api/users/${b.id}`).send({ role: 'technician' }),
        b.agent.patch(`/api/users/${a.id}`).send({ role: 'technician' }),
      ]);

      // Which guard refuses the loser depends on timing: if its request is authenticated
      // after the winner commits, it's no longer an admin (403); if both get past
      // authenticate, the admin-row locks make the second one see a single admin (400).
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0]).toBe(200);
      expect([400, 403]).toContain(statuses[1]);
      expect(await activeAdminCount(orgId)).toBe(1);
    });

    // Waits until at least `count` database sessions are blocked waiting for a lock.
    async function waitForBlockedSessions(count) {
      for (let i = 0; i < 100; i += 1) {
        const { rows } = await ownerPool.query(
          'SELECT count(DISTINCT pid)::int AS n FROM pg_locks WHERE NOT granted',
        );
        if (rows[0].n >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Expected ${count} blocked sessions`);
    }

    it('serialises concurrent demotions with row locks, so the second sees LAST_ADMIN', async () => {
      const { orgId, a, b } = await orgWithTwoAdmins();

      // Force a real overlap: hold both admin rows locked from another connection, start
      // both demotions (calling the service directly, so no authenticate step can refuse
      // one early), wait until both are blocked inside their transactions, then let go.
      const blocker = await ownerPool.connect();
      let results;
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM users WHERE id = ANY($1) FOR UPDATE', [[a.id, b.id]]);
        const pending = Promise.allSettled([
          usersService.updateUser(a, b.id, { role: 'technician' }),
          usersService.updateUser(b, a.id, { role: 'technician' }),
        ]);
        await waitForBlockedSessions(2);
        await blocker.query('COMMIT');
        results = await pending;
      } finally {
        blocker.release();
      }

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.code).toBe('LAST_ADMIN');
      expect(await activeAdminCount(orgId)).toBe(1);
    });
  });
});

describe('PATCH /api/users/me', () => {
  it('lets any user change their name and email notifications', async () => {
    const user = await createUser();
    const agent = await loginAs(user.email, user.password);

    const res = await agent
      .patch('/api/users/me')
      .send({ name: 'New Name', emailNotifications: false, role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'New Name',
      email_notifications: false,
      role: 'end_user',
    });
  });

  it('changes the password only with the correct current password', async () => {
    const user = await createUser();
    const agent = await loginAs(user.email, user.password);

    const noCurrent = await agent.patch('/api/users/me').send({ newPassword: 'Brandnew1pass' });
    const wrongCurrent = await agent
      .patch('/api/users/me')
      .send({ currentPassword: 'Wrongpassword1', newPassword: 'Brandnew1pass' });
    const ok = await agent
      .patch('/api/users/me')
      .send({ currentPassword: user.password, newPassword: 'Brandnew1pass' });

    expect(noCurrent.status).toBe(400);
    expect(noCurrent.body.error.details.fieldErrors.currentPassword).toBeDefined();
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error.code).toBe('INVALID_PASSWORD');
    expect(ok.status).toBe(200);
    expect((await login(user.email, user.password)).status).toBe(401);
    expect((await login(user.email, 'Brandnew1pass')).status).toBe(200);
  });

  it('applies the password rules to the new password', async () => {
    const agent = await loginAs(USERS.acme.user3.email);

    const res = await agent
      .patch('/api/users/me')
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.newPassword).toBeDefined();
  });

  it('is 401 without a session', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('X-Forwarded-For', nextTestIp())
      .send({ name: 'X' });

    expect(res.status).toBe(401);
  });
});

describe('user id parameter', () => {
  // ids are INT columns. A bigger number used to reach Postgres, fail with "value out of
  // range" and come back as a 500; it's now a validation error.
  it.each(['2147483648', '99999999999', '0', 'abc'])(
    'rejects /api/users/%s with 400',
    async (id) => {
      const admin = await loginAs(USERS.acme.admin.email);

      const res = await admin.patch(`/api/users/${id}`).send({ department: 'IT' });

      expect(res.status).toBe(400);
      expect(res.body.error.details.fieldErrors.id).toBeDefined();
    },
  );

  it('accepts the largest INT and answers 404 when no such user exists', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    const res = await admin.patch('/api/users/2147483647').send({ department: 'IT' });

    expect(res.status).toBe(404);
  });
});
