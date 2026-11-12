// Tickets API: creation and numbering, visibility, list filters, search, sorting, pagination and edits.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import {
  app,
  closePools,
  createTicket,
  eventsFor,
  loginAs,
  ownerPool,
  registerOrg,
  setTicketColumns,
  setUpOrg,
  ticketBody,
} from '../helpers.js';

afterAll(closePools);

describe('POST /api/tickets', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('creates a ticket for the signed-in user with a created event', async () => {
    const res = await ctx.alice.post('/api/tickets').send({
      title: '  Laptop will not boot  ',
      description: 'It shows a black screen after the logo.',
      categoryId: ctx.categoryId('Hardware'),
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Laptop will not boot',
      status: 'open',
      priority: 'medium',
      requester_id: ctx.aliceUser.id,
      requester_name: 'Alice User',
      category_name: 'Hardware',
      assignee_id: null,
      assignee_name: null,
      organization_id: ctx.org.id,
    });
    expect(res.body.display_id).toBe(`RES-${res.body.ticket_number}`);
    expect(await eventsFor(res.body.id)).toEqual([
      { actor_id: ctx.aliceUser.id, field: 'created', old_value: null, new_value: 'open' },
    ]);
  });

  it('ignores organization_id, requester_id and status sent in the body', async () => {
    const res = await ctx.alice.post('/api/tickets').send(
      ticketBody({
        organization_id: 1,
        requesterId: ctx.bobUser.id,
        requester_id: ctx.bobUser.id,
        status: 'closed',
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organization_id: ctx.org.id,
      requester_id: ctx.aliceUser.id,
      status: 'open',
    });
  });

  it('refuses critical priority from an end user with 403', async () => {
    const res = await ctx.alice.post('/api/tickets').send(ticketBody({ priority: 'critical' }));

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only support staff can set critical priority');
  });

  it('lets an end user choose low, medium or high', async () => {
    for (const priority of ['low', 'medium', 'high']) {
      const res = await ctx.alice.post('/api/tickets').send(ticketBody({ priority }));
      expect(res.body.priority).toBe(priority);
    }
  });

  it('lets staff set critical priority', async () => {
    const res = await ctx.tech.post('/api/tickets').send(ticketBody({ priority: 'critical' }));

    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('critical');
  });

  it("rejects another organization's category with a field error", async () => {
    const { rows } = await ownerPool.query(
      `SELECT c.id FROM categories c JOIN organizations o ON o.id = c.organization_id
       WHERE o.slug = 'globex' LIMIT 1`,
    );

    const res = await ctx.alice.post('/api/tickets').send(ticketBody({ categoryId: rows[0].id }));

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.categoryId).toEqual(['Category not found']);
  });

  it('validates title and description lengths', async () => {
    const res = await ctx.alice.post('/api/tickets').send({ title: 'Hi', description: 'Short' });

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual([
      'description',
      'title',
    ]);
  });

  it('requires a session', async () => {
    const res = await request(app).post('/api/tickets').send(ticketBody());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tickets', () => {
  // A small, known queue in its own org:
  //   RES-1001 Alice  low       Hardware  open         unassigned
  //   RES-1002 Alice  high      Network   in_progress  tech
  //   RES-1003 Bob    medium    Hardware  on_hold      admin
  //   RES-1004 Bob    critical  Email     resolved     tech      (created by the technician for Bob)
  //   RES-1005 Alice  medium    -         closed       unassigned  title has "100%"
  let ctx;
  let t; // tickets by number: t[1001] ...
  const ids = (res) => res.body.data.map((row) => row.ticket_number);

  beforeAll(async () => {
    ctx = await setUpOrg();
    const make = async (agent, body, columns) => {
      const ticket = await createTicket(agent, body);
      if (columns) await setTicketColumns(ticket.id, columns);
      return ticket;
    };
    const tickets = [
      await make(ctx.alice, {
        title: 'Mouse not working',
        priority: 'low',
        categoryId: ctx.categoryId('Hardware'),
      }),
      await make(
        ctx.alice,
        { title: 'VPN keeps dropping', priority: 'high', categoryId: ctx.categoryId('Network') },
        { status: 'in_progress', assignee_id: ctx.techUser.id },
      ),
      await make(
        ctx.bob,
        { title: 'Monitor flickers', categoryId: ctx.categoryId('Hardware') },
        { status: 'on_hold', assignee_id: ctx.adminUser.id },
      ),
      await make(
        ctx.tech,
        { title: 'Mailbox full', priority: 'critical', categoryId: ctx.categoryId('Email') },
        { status: 'resolved', assignee_id: ctx.techUser.id, requester_id: ctx.bobUser.id },
      ),
      await make(ctx.alice, { title: 'Disk is 100% full' }, { status: 'closed' }),
    ];
    t = Object.fromEntries(tickets.map((ticket) => [ticket.ticket_number, ticket]));
    expect(Object.keys(t)).toEqual(['1001', '1002', '1003', '1004', '1005']);
  });

  it('shows staff every ticket in the org, newest first by default', async () => {
    const res = await ctx.tech.get('/api/tickets');

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([1005, 1004, 1003, 1002, 1001]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 25, total: 5, totalPages: 1 });
  });

  it('shows an end user only the tickets they requested', async () => {
    expect(ids(await ctx.alice.get('/api/tickets'))).toEqual([1005, 1002, 1001]);
    expect(ids(await ctx.bob.get('/api/tickets'))).toEqual([1004, 1003]);
  });

  it('never includes another organization', async () => {
    const acmeAdmin = await loginAs(USERS.acme.admin.email);
    const res = await acmeAdmin.get('/api/tickets?pageSize=100');

    expect(res.body.data.every((row) => row.organization_id !== ctx.org.id)).toBe(true);
  });

  it('returns queue rows with joined names and without the description', async () => {
    const res = await ctx.tech.get('/api/tickets?search=RES-1002');

    expect(res.body.data[0]).toMatchObject({
      display_id: 'RES-1002',
      requester_name: 'Alice User',
      assignee_name: 'Tess Tech',
      category_name: 'Network',
    });
    expect(res.body.data[0]).not.toHaveProperty('description');
    expect(res.body.data[0]).not.toHaveProperty('total_count');
  });

  it.each([
    ['status=open', [1001]],
    ['status=open,in_progress,on_hold', [1003, 1002, 1001]],
    ['priority=critical', [1004]],
    ['priority=low,high', [1002, 1001]],
    ['assignee=unassigned', [1005, 1001]],
    ['assignee=me', [1004, 1002]],
    ['categoryId=HARDWARE', [1003, 1001]],
    ['status=resolved,in_progress&assignee=me', [1004, 1002]],
    ['priority=medium&categoryId=HARDWARE', [1003]],
    ['status=closed&priority=high', []],
  ])('filters by %s', async (query, expected) => {
    const resolved = query.replace('HARDWARE', String(ctx.categoryId('Hardware')));
    const res = await ctx.tech.get(`/api/tickets?${resolved}`);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(expected);
  });

  it('filters by a specific assignee id', async () => {
    expect(ids(await ctx.tech.get(`/api/tickets?assignee=${ctx.adminUser.id}`))).toEqual([1003]);
  });

  it('applies filters on top of the end-user visibility rule', async () => {
    expect(ids(await ctx.alice.get('/api/tickets?status=on_hold'))).toEqual([]);
    expect(ids(await ctx.alice.get('/api/tickets?priority=high'))).toEqual([1002]);
  });

  it.each([
    ['RES-1003', [1003]],
    ['res-1003', [1003]],
    ['1004', [1004]],
    ['vpn', [1002]],
    ['  mon  ', [1003]],
    ['100%', [1005]],
    // Wildcards match literally: "%" finds only the title containing "%", not every ticket.
    ['%', [1005]],
    ['_', []],
  ])('searches for %j', async (search, expected) => {
    const res = await ctx.tech.get('/api/tickets').query({ search });

    expect(ids(res)).toEqual(expected);
  });

  it("does not let an end user find another requester's ticket by number", async () => {
    expect(ids(await ctx.alice.get('/api/tickets?search=RES-1003'))).toEqual([]);
  });

  it('sorts by priority in severity order', async () => {
    expect(ids(await ctx.tech.get('/api/tickets?sort=priority&order=desc'))).toEqual([
      1004, 1002, 1005, 1003, 1001,
    ]);
    expect(ids(await ctx.tech.get('/api/tickets?sort=priority&order=asc'))).toEqual([
      1001, 1005, 1003, 1002, 1004,
    ]);
  });

  it('sorts by created_at ascending', async () => {
    expect(ids(await ctx.tech.get('/api/tickets?sort=created_at&order=asc'))).toEqual([
      1001, 1002, 1003, 1004, 1005,
    ]);
  });

  it('puts tickets without a due date last, then newest id first', async () => {
    await setTicketColumns(t[1003].id, { resolution_due_at: '2030-01-01T00:00:00Z' });
    await setTicketColumns(t[1001].id, { resolution_due_at: '2030-06-01T00:00:00Z' });
    try {
      expect(ids(await ctx.tech.get('/api/tickets?sort=resolution_due_at&order=asc'))).toEqual([
        1003, 1001, 1005, 1004, 1002,
      ]);
    } finally {
      await setTicketColumns(t[1003].id, { resolution_due_at: null });
      await setTicketColumns(t[1001].id, { resolution_due_at: null });
    }
  });

  it('paginates with totals', async () => {
    const page2 = await ctx.tech.get('/api/tickets?pageSize=2&page=2');

    expect(ids(page2)).toEqual([1003, 1002]);
    expect(page2.body.pagination).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });

    const page3 = await ctx.tech.get('/api/tickets?pageSize=2&page=3');
    expect(ids(page3)).toEqual([1001]);
  });

  it('still reports the total on a page past the end', async () => {
    const res = await ctx.tech.get('/api/tickets?pageSize=2&page=9');

    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 9, pageSize: 2, total: 5, totalPages: 3 });
  });

  it('reports zero pages when nothing matches', async () => {
    const res = await ctx.tech.get('/api/tickets?search=nothing-matches-this');

    expect(res.body.pagination).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  });

  it.each([
    'sort=title;DROP TABLE tickets',
    'sort=title',
    'order=up',
    'status=pending',
    'pageSize=500',
    'page=0',
    'assignee=nobody',
  ])('rejects %s with 400', async (query) => {
    const res = await ctx.tech.get(`/api/tickets?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('still has its tickets table after the injection attempt', async () => {
    const { rows } = await ownerPool.query("SELECT to_regclass('public.tickets') AS t");
    expect(rows[0].t).toBe('tickets');
  });
});

describe('GET /api/tickets/:id', () => {
  let ctx;
  let ticket;
  beforeAll(async () => {
    ctx = await setUpOrg();
    ticket = await createTicket(ctx.alice, { categoryId: ctx.categoryId('Software') });
  });

  it('returns the full ticket to its requester and to staff', async () => {
    for (const agent of [ctx.alice, ctx.tech, ctx.admin]) {
      const res = await agent.get(`/api/tickets/${ticket.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: ticket.id,
        display_id: 'RES-1001',
        description: 'Something is not working as expected.',
        category_name: 'Software',
      });
    }
  });

  it("gives another end user 404, the same as a ticket that doesn't exist", async () => {
    const other = await ctx.bob.get(`/api/tickets/${ticket.id}`);
    const missing = await ctx.bob.get('/api/tickets/2147483647');

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(other.body.error.message).toBe('Ticket not found');
  });

  it("gives another organization's admin 404", async () => {
    const globexAdmin = await loginAs(USERS.globex.admin.email);
    expect((await globexAdmin.get(`/api/tickets/${ticket.id}`)).status).toBe(404);
  });

  it('rejects an id that is not a positive integer with 400', async () => {
    for (const id of ['abc', '0', '-1', '2147483648']) {
      expect((await ctx.tech.get(`/api/tickets/${id}`)).status).toBe(400);
    }
  });
});

describe('PATCH /api/tickets/:id', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('lets the requester edit title, description and category while open, with one event per field', async () => {
    const ticket = await createTicket(ctx.alice, {
      title: 'Old title',
      categoryId: ctx.categoryId('Hardware'),
    });

    const res = await ctx.alice.patch(`/api/tickets/${ticket.id}`).send({
      title: 'New title',
      description: 'A clearer description of the problem.',
      categoryId: ctx.categoryId('Software'),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'New title',
      description: 'A clearer description of the problem.',
      category_name: 'Software',
    });
    expect(new Date(res.body.updated_at) > new Date(ticket.updated_at)).toBe(true);
    expect((await eventsFor(ticket.id)).slice(1)).toEqual([
      {
        actor_id: ctx.aliceUser.id,
        field: 'title',
        old_value: 'Old title',
        new_value: 'New title',
      },
      {
        actor_id: ctx.aliceUser.id,
        field: 'description',
        old_value: 'Something is not working as expected.',
        new_value: 'A clearer description of the problem.',
      },
      {
        actor_id: ctx.aliceUser.id,
        field: 'category',
        old_value: 'Hardware',
        new_value: 'Software',
      },
    ]);
  });

  it('records clearing the category as a change to null', async () => {
    const ticket = await createTicket(ctx.alice, { categoryId: ctx.categoryId('Email') });

    const res = await ctx.alice.patch(`/api/tickets/${ticket.id}`).send({ categoryId: null });

    expect(res.body.category_id).toBeNull();
    expect((await eventsFor(ticket.id)).at(-1)).toMatchObject({
      field: 'category',
      old_value: 'Email',
      new_value: null,
    });
  });

  it('writes no event and keeps updated_at when nothing actually changes', async () => {
    const ticket = await createTicket(ctx.alice, { title: 'Same title' });

    const res = await ctx.alice.patch(`/api/tickets/${ticket.id}`).send({ title: 'Same title' });

    expect(res.status).toBe(200);
    expect(res.body.updated_at).toBe(ticket.updated_at);
    expect(await eventsFor(ticket.id)).toHaveLength(1);
  });

  it("stops the requester editing once the ticket isn't open (403)", async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { status: 'in_progress' });

    const res = await ctx.alice.patch(`/api/tickets/${ticket.id}`).send({ title: 'Too late now' });

    expect(res.status).toBe(403);
    expect(await eventsFor(ticket.id)).toHaveLength(1);
  });

  it('lets staff edit at any status except closed, including priority', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { status: 'on_hold' });

    const res = await ctx.tech
      .patch(`/api/tickets/${ticket.id}`)
      .send({ title: 'Edited by tech', priority: 'critical' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Edited by tech', priority: 'critical' });
    expect((await eventsFor(ticket.id)).at(-1)).toEqual({
      actor_id: ctx.techUser.id,
      field: 'priority',
      old_value: 'medium',
      new_value: 'critical',
    });
  });

  it('lets nobody edit a closed ticket (400)', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { status: 'closed' });

    for (const agent of [ctx.alice, ctx.tech, ctx.admin]) {
      const res = await agent.patch(`/api/tickets/${ticket.id}`).send({ title: 'Reopen please' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TICKET_CLOSED');
    }
  });

  it("doesn't let the requester change the priority after creating the ticket (403)", async () => {
    const ticket = await createTicket(ctx.alice, { priority: 'low' });

    const res = await ctx.alice.patch(`/api/tickets/${ticket.id}`).send({ priority: 'high' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only support staff can change the priority');
  });

  it("gives 404 for another end user's ticket and another org's ticket", async () => {
    const ticket = await createTicket(ctx.alice);
    const globexAdmin = await loginAs(USERS.globex.admin.email);

    for (const agent of [ctx.bob, globexAdmin]) {
      const res = await agent.patch(`/api/tickets/${ticket.id}`).send({ title: 'Not yours' });
      expect(res.status).toBe(404);
    }
    expect(await eventsFor(ticket.id)).toHaveLength(1);
  });

  it("rejects another organization's category", async () => {
    const ticket = await createTicket(ctx.alice);
    const { rows } = await ownerPool.query(
      `SELECT c.id FROM categories c JOIN organizations o ON o.id = c.organization_id
       WHERE o.slug = 'acme-corp' LIMIT 1`,
    );

    const res = await ctx.tech.patch(`/api/tickets/${ticket.id}`).send({ categoryId: rows[0].id });

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.categoryId).toEqual(['Category not found']);
  });

  describe('optimistic locking', () => {
    it('accepts the update when expectedUpdatedAt matches', async () => {
      const ticket = await createTicket(ctx.alice);

      const res = await ctx.tech
        .patch(`/api/tickets/${ticket.id}`)
        .send({ title: 'Fresh edit here', expectedUpdatedAt: ticket.updated_at });

      expect(res.status).toBe(200);
    });

    it('refuses with 409 when someone changed the ticket in between', async () => {
      const ticket = await createTicket(ctx.alice);
      // The admin edits first...
      await ctx.admin.patch(`/api/tickets/${ticket.id}`).send({ title: 'Admin got here first' });

      // ...then the technician saves changes made to the copy loaded before that edit.
      const res = await ctx.tech
        .patch(`/api/tickets/${ticket.id}`)
        .send({ title: 'Tech overwrites', expectedUpdatedAt: ticket.updated_at });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(
        'This ticket was changed by someone else. Reload and try again.',
      );
      const current = await ctx.tech.get(`/api/tickets/${ticket.id}`);
      expect(current.body.title).toBe('Admin got here first');
    });

    it('rejects a malformed expectedUpdatedAt with 400', async () => {
      const ticket = await createTicket(ctx.alice);

      const res = await ctx.tech
        .patch(`/api/tickets/${ticket.id}`)
        .send({ title: 'Fresh edit here', expectedUpdatedAt: 'yesterday' });

      expect(res.status).toBe(400);
    });
  });

  it('requires at least one field', async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await ctx.alice.patch(`/api/tickets/${ticket.id}`).send({});

    expect(res.status).toBe(400);
  });

  it('serializes concurrent edits so every change gets its own event', async () => {
    const ticket = await createTicket(ctx.alice);

    const results = await Promise.all(
      ['Parallel title A', 'Parallel title B', 'Parallel title C'].map((title) =>
        ctx.tech.patch(`/api/tickets/${ticket.id}`).send({ title }),
      ),
    );

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const titleEvents = (await eventsFor(ticket.id)).filter((e) => e.field === 'title');
    expect(titleEvents).toHaveLength(3);
    // Each event's old value is the previous event's new value: no edit saw stale data.
    for (let i = 1; i < titleEvents.length; i += 1) {
      expect(titleEvents[i].old_value).toBe(titleEvents[i - 1].new_value);
    }
    const final = await ctx.tech.get(`/api/tickets/${ticket.id}`);
    expect(final.body.title).toBe(titleEvents.at(-1).new_value);
  });
});

describe('ticket numbers', () => {
  it('start at 1001 and count up separately in each organization', async () => {
    const first = await registerOrg();
    const second = await registerOrg();

    const a1 = await createTicket(first.agent);
    const a2 = await createTicket(first.agent);
    const b1 = await createTicket(second.agent);
    const a3 = await createTicket(first.agent);

    expect([a1, a2, a3].map((t) => t.display_id)).toEqual(['RES-1001', 'RES-1002', 'RES-1003']);
    expect(b1.display_id).toBe('RES-1001');
  });

  it('never hands out the same number to tickets created at the same moment', async () => {
    const { agent } = await registerOrg();

    const created = await Promise.all(Array.from({ length: 5 }, () => createTicket(agent)));

    const numbers = created.map((t) => t.ticket_number).sort();
    expect(numbers).toEqual([1001, 1002, 1003, 1004, 1005]);
  });
});
