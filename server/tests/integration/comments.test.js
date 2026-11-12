// Ticket conversation API: comments and internal notes, first response, event history and activity feed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import {
  closePools,
  createTicket,
  eventsFor,
  loginAs,
  ownerPool,
  setTicketColumns,
  setUpOrg,
} from '../helpers.js';

afterAll(closePools);

function comment(agent, ticketId, body, isInternal) {
  return agent.post(`/api/tickets/${ticketId}/comments`).send({ body, isInternal });
}

async function firstResponseAt(agent, ticketId) {
  return (await agent.get(`/api/tickets/${ticketId}`)).body.first_response_at;
}

describe('POST and GET /api/tickets/:id/comments', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('adds a public comment and lists comments oldest first with author name and role', async () => {
    const ticket = await createTicket(ctx.alice);

    const created = await comment(ctx.alice, ticket.id, '  My screen is still black.  ');
    await comment(ctx.tech, ticket.id, 'Have you tried another cable?');

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      ticket_id: ticket.id,
      author_id: ctx.aliceUser.id,
      author_name: 'Alice User',
      author_role: 'end_user',
      body: 'My screen is still black.',
      is_internal: false,
    });

    const list = await ctx.alice.get(`/api/tickets/${ticket.id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((c) => [c.author_name, c.author_role, c.body])).toEqual([
      ['Alice User', 'end_user', 'My screen is still black.'],
      ['Tess Tech', 'technician', 'Have you tried another cable?'],
    ]);
  });

  it('shows internal notes to staff only', async () => {
    const ticket = await createTicket(ctx.alice);
    await comment(ctx.tech, ticket.id, 'Public reply');
    const note = await comment(ctx.tech, ticket.id, 'Internal: probably the GPU', true);
    expect(note.status).toBe(201);
    expect(note.body.is_internal).toBe(true);

    const asStaff = await ctx.admin.get(`/api/tickets/${ticket.id}/comments`);
    expect(asStaff.body.data.map((c) => c.body)).toEqual([
      'Public reply',
      'Internal: probably the GPU',
    ]);

    const asRequester = await ctx.alice.get(`/api/tickets/${ticket.id}/comments`);
    expect(asRequester.body.data.map((c) => c.body)).toEqual(['Public reply']);
  });

  it('refuses an internal note from an end user with 403', async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await comment(ctx.alice, ticket.id, 'Let me see the notes', true);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only support staff can add internal notes');
  });

  it('validates the body: 1 to 5000 characters after trimming', async () => {
    const ticket = await createTicket(ctx.alice);
    for (const body of ['', '   ', 'x'.repeat(5001), undefined]) {
      const res = await comment(ctx.alice, ticket.id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await comment(ctx.alice, ticket.id, 'x'.repeat(5000))).status).toBe(201);
  });

  it('refuses comments on a closed ticket', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { status: 'closed' });

    for (const agent of [ctx.alice, ctx.tech]) {
      const res = await comment(agent, ticket.id, 'Hello?');
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'TICKET_CLOSED',
        message: 'This ticket is closed. Please submit a new one.',
      });
    }
  });

  it("returns 404 for another user's ticket and another organization's ticket", async () => {
    const ticket = await createTicket(ctx.alice);
    const globexAdmin = await loginAs(USERS.globex.admin.email);

    for (const agent of [ctx.bob, globexAdmin]) {
      expect((await agent.get(`/api/tickets/${ticket.id}/comments`)).status).toBe(404);
      expect((await comment(agent, ticket.id, 'Hi')).status).toBe(404);
    }
  });

  it('rejects a ticket id that is not a valid id with 400', async () => {
    const res = await ctx.tech.get('/api/tickets/abc/comments');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('first response', () => {
    it('is set only by the first public staff comment', async () => {
      const ticket = await createTicket(ctx.alice);

      await comment(ctx.alice, ticket.id, 'Requester comment');
      expect(await firstResponseAt(ctx.tech, ticket.id)).toBeNull();

      await comment(ctx.tech, ticket.id, 'Internal note', true);
      expect(await firstResponseAt(ctx.tech, ticket.id)).toBeNull();

      const reply = await comment(ctx.tech, ticket.id, 'First public reply');
      const first = await firstResponseAt(ctx.tech, ticket.id);
      expect(first).toBe(reply.body.created_at);

      await comment(ctx.admin, ticket.id, 'Second public reply');
      expect(await firstResponseAt(ctx.tech, ticket.id)).toBe(first);
    });
  });

  describe('requester reply on an on_hold ticket', () => {
    it('moves the ticket back to in_progress with a status event', async () => {
      const ticket = await createTicket(ctx.alice);
      await ctx.tech.patch(`/api/tickets/${ticket.id}/status`).send({ status: 'on_hold' });

      await comment(ctx.alice, ticket.id, 'Here is the information you asked for.');

      expect((await ctx.alice.get(`/api/tickets/${ticket.id}`)).body.status).toBe('in_progress');
      expect((await eventsFor(ticket.id)).at(-1)).toEqual({
        actor_id: ctx.aliceUser.id,
        field: 'status',
        old_value: 'on_hold',
        new_value: 'in_progress',
      });
    });

    it('leaves the status alone for staff comments and other statuses', async () => {
      const onHold = await createTicket(ctx.alice);
      await ctx.tech.patch(`/api/tickets/${onHold.id}/status`).send({ status: 'on_hold' });
      await comment(ctx.tech, onHold.id, 'Still waiting for your reply.');
      expect((await ctx.tech.get(`/api/tickets/${onHold.id}`)).body.status).toBe('on_hold');

      const open = await createTicket(ctx.alice);
      await comment(ctx.alice, open.id, 'Any update?');
      expect((await ctx.tech.get(`/api/tickets/${open.id}`)).body.status).toBe('open');
    });
  });
});

// One ticket with a bit of everything, built through the API in a known order.
describe('GET /api/tickets/:id/events and /activity', () => {
  let ctx;
  let ticket;
  beforeAll(async () => {
    ctx = await setUpOrg();
    ticket = await createTicket(ctx.alice, { priority: 'low' });
    const id = ticket.id;
    await ctx.admin.patch(`/api/tickets/${id}/assignment`).send({ assigneeId: ctx.techUser.id });
    await ctx.tech.patch(`/api/tickets/${id}/priority`).send({ priority: 'high' });
    await comment(ctx.tech, id, 'Can you send a photo of the screen?');
    await comment(ctx.tech, id, 'Looks like a hardware fault', true);
    await ctx.tech.patch(`/api/tickets/${id}/status`).send({ status: 'on_hold' });
    await comment(ctx.alice, id, 'Photo attached.');
    // A change made by the system (as the Phase 6 SLA job will), with no actor.
    await ownerPool.query(
      `INSERT INTO ticket_events (organization_id, ticket_id, actor_id, field, new_value)
       VALUES ($1, $2, NULL, 'sla_breach', 'resolution')`,
      [ctx.org.id, id],
    );
  });

  describe('events', () => {
    it('gives staff every event, newest first, with actor names and "System"', async () => {
      const res = await ctx.tech.get(`/api/tickets/${ticket.id}/events`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((e) => [e.actor_name, e.field, e.old_value, e.new_value])).toEqual([
        ['System', 'sla_breach', null, 'resolution'],
        ['Alice User', 'status', 'on_hold', 'in_progress'],
        ['Tess Tech', 'status', 'in_progress', 'on_hold'],
        // The priority change moved both SLA deadlines (new values checked in sla.test.js).
        ['Tess Tech', 'resolution_due_at', ticket.resolution_due_at, expect.any(String)],
        ['Tess Tech', 'response_due_at', ticket.response_due_at, expect.any(String)],
        ['Tess Tech', 'priority', 'low', 'high'],
        ['Org Admin', 'status', 'open', 'in_progress'],
        ['Org Admin', 'assignee', 'Unassigned', 'Tess Tech'],
        ['Alice User', 'created', null, 'open'],
      ]);
      expect(res.body.data[0]).toMatchObject({ actor_id: null, ticket_id: ticket.id });
    });

    it('gives the requester only created and status events', async () => {
      const res = await ctx.alice.get(`/api/tickets/${ticket.id}/events`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((e) => [e.field, e.new_value])).toEqual([
        ['status', 'in_progress'],
        ['status', 'on_hold'],
        ['status', 'in_progress'],
        ['created', 'open'],
      ]);
    });
  });

  describe('activity', () => {
    it('merges comments and events oldest first, in one shape, for staff', async () => {
      const res = await ctx.admin.get(`/api/tickets/${ticket.id}/activity`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(
        [
          'type',
          'id',
          'actor_name',
          'body',
          'field',
          'old_value',
          'new_value',
          'is_internal',
          'created_at',
        ].sort(),
      );
      expect(
        res.body.data.map((a) => [a.type, a.actor_name, a.field ?? a.body, a.is_internal]),
      ).toEqual([
        ['event', 'Alice User', 'created', false],
        ['event', 'Org Admin', 'assignee', true],
        ['event', 'Org Admin', 'status', false],
        ['event', 'Tess Tech', 'priority', true],
        ['event', 'Tess Tech', 'response_due_at', true],
        ['event', 'Tess Tech', 'resolution_due_at', true],
        ['comment', 'Tess Tech', 'Can you send a photo of the screen?', false],
        ['comment', 'Tess Tech', 'Looks like a hardware fault', true],
        ['event', 'Tess Tech', 'status', false],
        // The reply and the status change it caused share a timestamp; the reply comes first.
        ['comment', 'Alice User', 'Photo attached.', false],
        ['event', 'Alice User', 'status', false],
        ['event', 'System', 'sla_breach', true],
      ]);
    });

    it('hides internal notes and staff-only events from the requester', async () => {
      const res = await ctx.alice.get(`/api/tickets/${ticket.id}/activity`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((a) => [a.type, a.field ?? a.body])).toEqual([
        ['event', 'created'],
        ['event', 'status'],
        ['comment', 'Can you send a photo of the screen?'],
        ['event', 'status'],
        ['comment', 'Photo attached.'],
        ['event', 'status'],
      ]);
      expect(res.body.data.every((a) => a.is_internal === false)).toBe(true);
    });
  });

  it("returns 404 for another user's ticket and another organization's ticket", async () => {
    const globexAdmin = await loginAs(USERS.globex.admin.email);
    for (const agent of [ctx.bob, globexAdmin]) {
      for (const path of ['events', 'activity']) {
        expect((await agent.get(`/api/tickets/${ticket.id}/${path}`)).status).toBe(404);
      }
    }
  });
});
