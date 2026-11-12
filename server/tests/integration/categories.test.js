// Categories endpoints: everyone in the org reads them, admins add and rename, orgs stay separate.
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import { app, closePools, loginAs, orgIdBySlug } from '../helpers.js';

afterAll(closePools);

describe('GET /api/categories', () => {
  it("lists only the signed-in user's org's categories, sorted by name", async () => {
    const agent = await loginAs(USERS.globex.user1.email);
    const globexId = await orgIdBySlug('globex');

    const res = await agent.get('/api/categories');

    expect(res.status).toBe(200);
    expect(res.body.data.every((c) => c.organization_id === globexId)).toBe(true);
    const names = res.body.data.map((c) => c.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('Account Access');
  });

  it('is 401 without a session', async () => {
    expect((await request(app).get('/api/categories')).status).toBe(401);
  });
});

describe('POST /api/categories', () => {
  it('lets an admin add a category (name trimmed)', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    const res = await admin.post('/api/categories').send({ name: '  Printers  ' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Printers');
  });

  it('rejects a duplicate name in the same org with 409, but allows it in another org', async () => {
    const acme = await loginAs(USERS.acme.admin.email);
    const globex = await loginAs(USERS.globex.admin.email);

    const dup = await acme.post('/api/categories').send({ name: 'Hardware' });
    const otherOrg = await globex.post('/api/categories').send({ name: 'Printers' });

    expect(dup.status).toBe(409);
    expect(dup.body.error.details.fieldErrors.name).toBeDefined();
    expect(otherOrg.status).toBe(201);
  });

  it('is 403 for end users and technicians', async () => {
    const user = await loginAs(USERS.acme.user1.email);
    const tech = await loginAs(USERS.acme.tech1.email);

    expect((await user.post('/api/categories').send({ name: 'Nope' })).status).toBe(403);
    expect((await tech.post('/api/categories').send({ name: 'Nope' })).status).toBe(403);
  });

  it('rejects an empty name with 400', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    expect((await admin.post('/api/categories').send({ name: '   ' })).status).toBe(400);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('lets an admin rename a category', async () => {
    const admin = await loginAs(USERS.acme.admin.email);
    const created = await admin.post('/api/categories').send({ name: 'Phones' });

    const res = await admin.patch(`/api/categories/${created.body.id}`).send({ name: 'Mobile' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, name: 'Mobile' });
  });

  it('is 404 when a Globex admin renames an Acme category', async () => {
    const acme = await loginAs(USERS.acme.admin.email);
    const globex = await loginAs(USERS.globex.admin.email);
    const created = await acme.post('/api/categories').send({ name: 'Acme Only' });

    const res = await globex.patch(`/api/categories/${created.body.id}`).send({ name: 'Taken' });

    expect(res.status).toBe(404);
  });

  it('rejects renaming to a name already used in the org with 409', async () => {
    const admin = await loginAs(USERS.acme.admin.email);
    const created = await admin.post('/api/categories').send({ name: 'Scanners' });

    const res = await admin.patch(`/api/categories/${created.body.id}`).send({ name: 'Email' });

    expect(res.status).toBe(409);
  });
});

describe('category id parameter', () => {
  // ids are INT columns. A bigger number used to reach Postgres, fail with "value out of
  // range" and come back as a 500; it's now a validation error.
  it.each(['2147483648', '99999999999', '0', 'abc'])(
    'rejects /api/categories/%s with 400',
    async (id) => {
      const admin = await loginAs(USERS.acme.admin.email);

      const res = await admin.patch(`/api/categories/${id}`).send({ name: 'Renamed' });

      expect(res.status).toBe(400);
      expect(res.body.error.details.fieldErrors.id).toBeDefined();
    },
  );

  it('accepts the largest INT and answers 404 when no such category exists', async () => {
    const admin = await loginAs(USERS.acme.admin.email);

    const res = await admin.patch('/api/categories/2147483647').send({ name: 'Renamed' });

    expect(res.status).toBe(404);
  });
});
