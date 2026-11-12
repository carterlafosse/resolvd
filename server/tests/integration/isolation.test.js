// Organization isolation: Globex can't read, change or even detect Acme's data, either through
// the API (layer 1, the services' org scoping) or in the database itself (layer 2, row-level security).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import { PG_INT_MAX } from '../../src/utils/idSchemas.js';
import { closePools, createTicket, loginAs, orgIdBySlug, ownerPool } from '../helpers.js';

afterAll(closePools);

// Every table that holds one organization's rows. The catalog test at the bottom fails if a
// migration adds a table with organization_id that isn't listed here.
const TENANT_TABLES = [
  'categories',
  'sla_policies',
  'ticket_comments',
  'ticket_events',
  'tickets',
  'users',
];

async function ownerRows(sql, params) {
  return (await ownerPool.query(sql, params)).rows;
}

async function userIdByEmail(email) {
  return (await ownerRows('SELECT id FROM users WHERE email = $1', [email]))[0].id;
}

// Shared by both describe blocks: the two seed orgs and an Acme ticket with a public reply
// and an internal note, so every kind of Acme record exists.
let acmeOrgId;
let globexOrgId;
let acmeTicket;

beforeAll(async () => {
  [acmeOrgId, globexOrgId] = await Promise.all([orgIdBySlug('acme-corp'), orgIdBySlug('globex')]);

  const [acmeUser, acmeTech] = await Promise.all([
    loginAs(USERS.acme.user1.email),
    loginAs(USERS.acme.tech1.email),
  ]);
  acmeTicket = await createTicket(acmeUser, { title: 'Acme laptop will not boot' });
  await acmeTech
    .post(`/api/tickets/${acmeTicket.id}/comments`)
    .send({ body: 'Looking into it now.' })
    .expect(201);
  await acmeTech
    .post(`/api/tickets/${acmeTicket.id}/comments`)
    .send({ body: 'Internal: probably the SSD.', isInternal: true })
    .expect(201);
});

describe('the API keeps organizations apart', () => {
  let globexAdmin;
  let globexTechId;
  let ids;

  beforeAll(async () => {
    globexAdmin = await loginAs(USERS.globex.admin.email);
    globexTechId = await userIdByEmail(USERS.globex.tech1.email);
    const acmeCategory = await ownerRows(
      'SELECT id FROM categories WHERE organization_id = $1 ORDER BY id LIMIT 1',
      [acmeOrgId],
    );
    ids = {
      ticket: acmeTicket.id,
      user: await userIdByEmail(USERS.acme.user2.email),
      category: acmeCategory[0].id,
    };
  });

  // Everything an attempt could touch, read as the owner (no RLS), to prove nothing changed.
  async function acmeSnapshot() {
    return {
      ticket: await ownerRows('SELECT * FROM tickets WHERE id = $1', [ids.ticket]),
      comments: await ownerRows('SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY id', [
        ids.ticket,
      ]),
      events: await ownerRows('SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY id', [
        ids.ticket,
      ]),
      user: await ownerRows('SELECT * FROM users WHERE id = $1', [ids.user]),
      category: await ownerRows('SELECT * FROM categories WHERE id = $1', [ids.category]),
    };
  }

  // Every endpoint that takes an id. Bodies are valid, so the only thing wrong with each
  // request is whose record it names. ":ticket", ":user" and ":category" become Acme ids.
  const ATTEMPTS = [
    ['GET', '/api/tickets/:ticket'],
    ['PATCH', '/api/tickets/:ticket', { title: 'Changed by Globex' }],
    ['PATCH', '/api/tickets/:ticket/status', { status: 'in_progress' }],
    ['PATCH', '/api/tickets/:ticket/assignment', () => ({ assigneeId: globexTechId })],
    ['POST', '/api/tickets/:ticket/assign-to-me'],
    ['PATCH', '/api/tickets/:ticket/priority', { priority: 'critical' }],
    ['GET', '/api/tickets/:ticket/comments'],
    ['POST', '/api/tickets/:ticket/comments', { body: 'Hello from Globex' }],
    ['GET', '/api/tickets/:ticket/events'],
    ['GET', '/api/tickets/:ticket/activity'],
    ['PATCH', '/api/users/:user', { name: 'Changed by Globex' }],
    ['PATCH', '/api/categories/:category', { name: 'Changed by Globex' }],
  ];

  function send(method, path, idFor, body) {
    const url = path.replace(/:(ticket|user|category)/, (_, kind) => idFor(kind));
    const req = globexAdmin[method.toLowerCase()](url);
    return body === undefined ? req : req.send(typeof body === 'function' ? body() : body);
  }

  it.each(ATTEMPTS)(
    'Globex admin: %s %s on an Acme record is 404 and changes nothing',
    async (method, path, body) => {
      const before = await acmeSnapshot();

      const res = await send(method, path, (kind) => ids[kind], body);
      // The same request for an id that doesn't exist at all: the answers must be identical,
      // so Globex can't even tell that the Acme record exists.
      const missing = await send(method, path, () => PG_INT_MAX, body);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(missing.status).toBe(404);
      expect(res.body).toEqual(missing.body);
      expect(await acmeSnapshot()).toEqual(before);
    },
  );

  describe('lists never contain Acme data', () => {
    let acmeIds;
    beforeAll(async () => {
      const idsIn = async (table) =>
        new Set(
          (await ownerRows(`SELECT id FROM ${table} WHERE organization_id = $1`, [acmeOrgId])).map(
            (r) => r.id,
          ),
        );
      acmeIds = {
        tickets: await idsIn('tickets'),
        users: await idsIn('users'),
        categories: await idsIn('categories'),
      };
    });

    // Reads every page, so an Acme ticket can't hide past the first one.
    async function allTickets(agent, query = {}) {
      const rows = [];
      for (let page = 1; ; page += 1) {
        const res = await agent.get('/api/tickets').query({ ...query, page, pageSize: 100 });
        expect(res.status).toBe(200);
        rows.push(...res.body.data);
        if (page >= res.body.pagination.totalPages) return rows;
      }
    }

    it.each([
      ['admin', USERS.globex.admin.email],
      ['technician', USERS.globex.tech1.email],
      ['end user', USERS.globex.user1.email],
    ])('tickets, as a Globex %s', async (_role, email) => {
      const agent = await loginAs(email);
      await createTicket(agent, { title: 'Globex printer is jammed' });

      const rows = await allTickets(agent);

      expect(rows.length).toBeGreaterThan(0);
      for (const ticket of rows) {
        expect(ticket.organization_id).toBe(globexOrgId);
        expect(acmeIds.tickets.has(ticket.id)).toBe(false);
      }
    });

    it("tickets searched by an Acme ticket's number or title", async () => {
      for (const search of [acmeTicket.display_id, 'Acme laptop']) {
        const rows = await allTickets(globexAdmin, { search });
        expect(rows.every((t) => t.organization_id === globexOrgId)).toBe(true);
        expect(rows.some((t) => t.id === acmeTicket.id)).toBe(false);
      }
    });

    it('users and categories', async () => {
      const users = (await globexAdmin.get('/api/users').expect(200)).body.data;
      const categories = (await globexAdmin.get('/api/categories').expect(200)).body.data;

      expect(users.length).toBeGreaterThan(0);
      expect(users.some((u) => acmeIds.users.has(u.id))).toBe(false);
      expect(users.some((u) => u.email.endsWith('@acme.test'))).toBe(false);
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.some((c) => acmeIds.categories.has(c.id))).toBe(false);
    });

    it("/auth/me reports Globex, and changing Globex's SLA policy leaves Acme's alone", async () => {
      const me = await globexAdmin.get('/api/auth/me').expect(200);
      expect(me.body.organization.id).toBe(globexOrgId);

      const acmeBefore = await ownerRows('SELECT * FROM sla_policies WHERE organization_id = $1', [
        acmeOrgId,
      ]);
      const globexLow = (await globexAdmin.get('/api/sla-policies').expect(200)).body.data.find(
        (p) => p.priority === 'low',
      );

      await globexAdmin
        .put('/api/sla-policies/low')
        .send({ responseMinutes: 30, resolutionMinutes: 60 })
        .expect(200);

      expect(
        await ownerRows('SELECT * FROM sla_policies WHERE organization_id = $1', [acmeOrgId]),
      ).toEqual(acmeBefore);

      // Put Globex's policy back for any later file that relies on the defaults.
      await globexAdmin
        .put('/api/sla-policies/low')
        .send({
          responseMinutes: globexLow.response_minutes,
          resolutionMinutes: globexLow.resolution_minutes,
        })
        .expect(200);
    });
  });

  describe('records from two organizations never mix', () => {
    it('an Acme ticket cannot be assigned to a Globex technician', async () => {
      const acmeAdmin = await loginAs(USERS.acme.admin.email);

      const res = await acmeAdmin
        .patch(`/api/tickets/${acmeTicket.id}/assignment`)
        .send({ assigneeId: globexTechId });

      expect(res.status).toBe(400);
      expect(res.body.error.details.fieldErrors.assigneeId).toBeDefined();
      const [row] = await ownerRows('SELECT assignee_id FROM tickets WHERE id = $1', [
        acmeTicket.id,
      ]);
      expect(row.assignee_id).toBeNull();
    });

    it('a Globex ticket cannot be assigned to an Acme technician or use an Acme category', async () => {
      const globexTicket = await createTicket(globexAdmin);
      const acmeTechId = await userIdByEmail(USERS.acme.tech1.email);

      const assign = await globexAdmin
        .patch(`/api/tickets/${globexTicket.id}/assignment`)
        .send({ assigneeId: acmeTechId });
      const create = await globexAdmin.post('/api/tickets').send({
        title: 'Uses an Acme category',
        description: 'This should be refused.',
        categoryId: ids.category,
      });

      expect(assign.status).toBe(400);
      expect(assign.body.error.details.fieldErrors.assigneeId).toBeDefined();
      expect(create.status).toBe(400);
      expect(create.body.error.details.fieldErrors.categoryId).toBeDefined();
    });
  });
});

// Layer 2 on its own: these queries have no WHERE organization_id clauses (or ask for the
// other org on purpose), so only row-level security can be what filters them.
describe('row-level security, connecting directly as resolvd_app', () => {
  let app;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
  });
  afterAll(() => app.end());

  async function count(table, where = '', params = []) {
    const { rows } = await app.query(`SELECT count(*)::int AS n FROM ${table} ${where}`, params);
    return rows[0].n;
  }

  async function ownerCount(table, orgId) {
    const { rows } = await ownerPool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
      [orgId],
    );
    return rows[0].n;
  }

  // Runs work inside a transaction with the org set, the way withOrg does, then rolls back.
  async function asOrg(orgId, work) {
    await app.query('BEGIN');
    try {
      await app.query("SELECT set_config('app.current_org_id', $1, true)", [String(orgId)]);
      return await work();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  it('connects as resolvd_app, which owns no tables (RLS never applies to an owner)', async () => {
    const { rows } = await app.query(
      `SELECT current_user AS role,
              (SELECT count(*)::int FROM pg_tables
               WHERE schemaname = 'public' AND tableowner = current_user) AS owned`,
    );
    expect(rows[0]).toEqual({ role: 'resolvd_app', owned: 0 });
  });

  it('sees no rows at all when no organization is set', async () => {
    // The data is there: the owner sees both orgs' tickets.
    expect(await ownerCount('tickets', acmeOrgId)).toBeGreaterThan(0);

    for (const table of [...TENANT_TABLES, 'organizations']) {
      expect(await count(table), table).toBe(0);
    }
  });

  it("sees exactly one organization's rows inside a transaction that sets it", async () => {
    for (const [orgId, otherId] of [
      [acmeOrgId, globexOrgId],
      [globexOrgId, acmeOrgId],
    ]) {
      await asOrg(orgId, async () => {
        for (const table of TENANT_TABLES) {
          expect(await count(table), table).toBe(await ownerCount(table, orgId));
          // Asking for the other org by name still finds nothing.
          expect(await count(table, 'WHERE organization_id = $1', [otherId]), table).toBe(0);
        }
        const { rows } = await app.query('SELECT id FROM organizations');
        expect(rows).toEqual([{ id: orgId }]);
      });
    }
  });

  it('forgets the organization when the transaction ends', async () => {
    await asOrg(acmeOrgId, async () => {
      expect(await count('tickets')).toBeGreaterThan(0);
    });
    expect(await count('tickets')).toBe(0);
  });

  it("can't insert, update or delete another organization's rows", async () => {
    await asOrg(acmeOrgId, async () => {
      const updated = await app.query(
        "UPDATE tickets SET title = 'Changed by Acme' WHERE organization_id = $1",
        [globexOrgId],
      );
      const deleted = await app.query('DELETE FROM ticket_comments WHERE organization_id = $1', [
        globexOrgId,
      ]);
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);

      // WITH CHECK rejects a new row labelled with another org.
      await expect(
        app.query("INSERT INTO categories (organization_id, name) VALUES ($1, 'Planted')", [
          globexOrgId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('has RLS enabled with the org_isolation policy on every table with organization_id', async () => {
    const { rows } = await ownerPool.query(
      `SELECT c.relname AS table,
              c.relrowsecurity AS rls,
              EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname
                        AND p.policyname = 'org_isolation') AS policy
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'organization_id'
                       AND NOT a.attisdropped)
       ORDER BY c.relname`,
    );

    expect(rows).toEqual(TENANT_TABLES.map((table) => ({ table, rls: true, policy: true })));
  });
});
