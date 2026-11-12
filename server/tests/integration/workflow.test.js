// Ticket workflow API: status changes, assignment and priority, with their events and row locking.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '../../db/seeds/users.js';
import {
  closePools,
  createTicket,
  createUser,
  eventsFor,
  loginAs,
  ownerPool,
  setTicketColumns,
  setUpOrg,
} from '../helpers.js';

afterAll(closePools);

const DAY = 24 * 60 * 60 * 1000;

function setStatus(agent, ticketId, status) {
  return agent.patch(`/api/tickets/${ticketId}/status`).send({ status });
}

// Status events in order, as [old, new] pairs.
async function statusHistory(ticketId) {
  return (await eventsFor(ticketId))
    .filter((e) => e.field === 'status')
    .map((e) => [e.old_value, e.new_value]);
}

describe('PATCH /api/tickets/:id/status', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('walks a ticket through its full lifecycle, recording each step', async () => {
    const ticket = await createTicket(ctx.alice);
    const steps = ['in_progress', 'on_hold', 'in_progress', 'resolved', 'closed'];

    let res;
    for (const status of steps) {
      res = await setStatus(ctx.tech, ticket.id, status);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }

    expect(res.body.resolved_at).not.toBeNull();
    expect(res.body.closed_at).not.toBeNull();
    expect(await statusHistory(ticket.id)).toEqual([
      ['open', 'in_progress'],
      ['in_progress', 'on_hold'],
      ['on_hold', 'in_progress'],
      ['in_progress', 'resolved'],
      ['resolved', 'closed'],
    ]);
    const events = await eventsFor(ticket.id);
    expect(
      events.filter((e) => e.field === 'status').every((e) => e.actor_id === ctx.techUser.id),
    ).toBe(true);
  });

  it('refuses an illegal jump with 400 and the reason, and changes nothing', async () => {
    const ticket = await createTicket(ctx.alice);

    const res = await setStatus(ctx.tech, ticket.id, 'closed');

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'INVALID_TRANSITION',
      message: "A ticket can't move from open to closed",
    });
    expect((await ctx.tech.get(`/api/tickets/${ticket.id}`)).body.status).toBe('open');
    expect(await statusHistory(ticket.id)).toEqual([]);
  });

  it('refuses the status the ticket already has', async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await setStatus(ctx.tech, ticket.id, 'open');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The ticket is already open');
  });

  it('refuses every change to a closed ticket', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { status: 'closed' });

    for (const status of ['open', 'in_progress', 'resolved']) {
      const res = await setStatus(ctx.admin, ticket.id, status);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('This ticket is closed. Please submit a new one.');
    }
  });

  it('rejects an unknown status with 400 VALIDATION_ERROR', async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await setStatus(ctx.tech, ticket.id, 'deleted');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets the requester close their resolved ticket (confirming the fix)', async () => {
    const ticket = await createTicket(ctx.alice);
    await setStatus(ctx.tech, ticket.id, 'resolved');

    const res = await setStatus(ctx.alice, ticket.id, 'closed');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.closed_at).not.toBeNull();
    expect((await eventsFor(ticket.id)).at(-1)).toEqual({
      actor_id: ctx.aliceUser.id,
      field: 'status',
      old_value: 'resolved',
      new_value: 'closed',
    });
  });

  it('lets the requester reopen their resolved ticket, clearing resolved_at', async () => {
    const ticket = await createTicket(ctx.alice);
    const resolved = await setStatus(ctx.tech, ticket.id, 'resolved');
    expect(resolved.body.resolved_at).not.toBeNull();

    const res = await setStatus(ctx.alice, ticket.id, 'open');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.resolved_at).toBeNull();
  });

  it('refuses a requester reopen 8 days after resolution, but staff can still reopen', async () => {
    const ticket = await createTicket(ctx.alice);
    await setStatus(ctx.tech, ticket.id, 'resolved');
    await setTicketColumns(ticket.id, { resolved_at: new Date(Date.now() - 8 * DAY) });

    const refused = await setStatus(ctx.alice, ticket.id, 'open');
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('INVALID_TRANSITION');
    expect(refused.body.error.message).toMatch(/within 7 days/);

    const staff = await setStatus(ctx.tech, ticket.id, 'open');
    expect(staff.status).toBe(200);
  });

  it("refuses staff-only moves from the requester with the workflow's reason", async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await setStatus(ctx.alice, ticket.id, 'resolved');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Only support staff can change the status of this ticket');
  });

  it("returns 404 for another user's ticket and for another organization's ticket", async () => {
    const ticket = await createTicket(ctx.alice);
    await setStatus(ctx.tech, ticket.id, 'resolved');

    const bob = await setStatus(ctx.bob, ticket.id, 'closed');
    expect(bob.status).toBe(404);

    const globexAdmin = await loginAs(USERS.globex.admin.email);
    const globex = await setStatus(globexAdmin, ticket.id, 'closed');
    expect(globex.status).toBe(404);

    expect(await statusHistory(ticket.id)).toEqual([['open', 'resolved']]);
  });

  describe('concurrent changes', () => {
    it('applies the same move once when it is sent five times at once', async () => {
      const ticket = await createTicket(ctx.alice);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => setStatus(ctx.tech, ticket.id, 'in_progress')),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
      expect(await statusHistory(ticket.id)).toEqual([['open', 'in_progress']]);
    });

    it('keeps the final status and the event history consistent for competing moves', async () => {
      const ticket = await createTicket(ctx.alice);
      await setStatus(ctx.tech, ticket.id, 'in_progress');

      // Whichever runs first, the second sees its result: resolved then on_hold is refused;
      // on_hold then resolved is allowed.
      const results = await Promise.all([
        setStatus(ctx.tech, ticket.id, 'resolved'),
        setStatus(ctx.admin, ticket.id, 'on_hold'),
      ]);

      const history = await statusHistory(ticket.id);
      const succeeded = results.filter((r) => r.status === 200).length;
      expect(history).toHaveLength(1 + succeeded);
      // Each event starts where the previous one ended.
      for (let i = 1; i < history.length; i += 1) {
        expect(history[i][0]).toBe(history[i - 1][1]);
      }
      const final = await ctx.tech.get(`/api/tickets/${ticket.id}`);
      expect(final.body.status).toBe(history.at(-1)[1]);
    });
  });
});

function assign(agent, ticketId, assigneeId) {
  return agent.patch(`/api/tickets/${ticketId}/assignment`).send({ assigneeId });
}

describe('PATCH /api/tickets/:id/assignment', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('assigns an open ticket, recording names and moving it to in_progress', async () => {
    const ticket = await createTicket(ctx.alice);

    const res = await assign(ctx.admin, ticket.id, ctx.techUser.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      assignee_id: ctx.techUser.id,
      assignee_name: 'Tess Tech',
      status: 'in_progress',
    });
    expect((await eventsFor(ticket.id)).slice(1)).toEqual([
      {
        actor_id: ctx.adminUser.id,
        field: 'assignee',
        old_value: 'Unassigned',
        new_value: 'Tess Tech',
      },
      {
        actor_id: ctx.adminUser.id,
        field: 'status',
        old_value: 'open',
        new_value: 'in_progress',
      },
    ]);
  });

  it('reassigns and unassigns without changing a status that is past open', async () => {
    const ticket = await createTicket(ctx.alice);
    await assign(ctx.admin, ticket.id, ctx.techUser.id);
    await setStatus(ctx.tech, ticket.id, 'on_hold');

    const reassigned = await assign(ctx.tech, ticket.id, ctx.adminUser.id);
    expect(reassigned.status).toBe(200);
    expect(reassigned.body).toMatchObject({ assignee_name: 'Org Admin', status: 'on_hold' });

    const unassigned = await assign(ctx.tech, ticket.id, null);
    expect(unassigned.status).toBe(200);
    expect(unassigned.body).toMatchObject({ assignee_id: null, status: 'on_hold' });

    const assigneeEvents = (await eventsFor(ticket.id))
      .filter((e) => e.field === 'assignee')
      .map((e) => [e.old_value, e.new_value]);
    expect(assigneeEvents).toEqual([
      ['Unassigned', 'Tess Tech'],
      ['Tess Tech', 'Org Admin'],
      ['Org Admin', 'Unassigned'],
    ]);
  });

  it('unassigning an open ticket leaves it open', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { assignee_id: ctx.techUser.id });

    const res = await assign(ctx.tech, ticket.id, null);

    expect(res.body.status).toBe('open');
    expect(await statusHistory(ticket.id)).toEqual([]);
  });

  it('writes nothing when the ticket already has that assignee', async () => {
    const ticket = await createTicket(ctx.alice);
    await assign(ctx.admin, ticket.id, ctx.techUser.id);
    const before = await eventsFor(ticket.id);

    const res = await assign(ctx.admin, ticket.id, ctx.techUser.id);

    expect(res.status).toBe(200);
    expect(await eventsFor(ticket.id)).toEqual(before);
  });

  it("refuses an end user, an inactive technician and another organization's technician", async () => {
    const ticket = await createTicket(ctx.alice);
    const inactiveTech = await createUser({ orgSlug: ctx.org.slug, role: 'technician' });
    await ownerPool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [inactiveTech.id]);
    const { rows } = await ownerPool.query('SELECT id FROM users WHERE email = $1', [
      USERS.globex.tech1.email,
    ]);

    for (const assigneeId of [ctx.bobUser.id, inactiveTech.id, rows[0].id, 2147483647]) {
      const res = await assign(ctx.admin, ticket.id, assigneeId);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fieldErrors.assigneeId).toEqual([
        'Tickets can only be assigned to an active technician or admin',
      ]);
    }
    expect(await eventsFor(ticket.id)).toHaveLength(1);
  });

  it('requires assigneeId (a positive number or null)', async () => {
    const ticket = await createTicket(ctx.alice);
    for (const body of [{}, { assigneeId: 'me' }, { assigneeId: 0 }]) {
      const res = await ctx.admin.patch(`/api/tickets/${ticket.id}/assignment`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('is staff only: the requester gets 403', async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await assign(ctx.alice, ticket.id, ctx.techUser.id);
    expect(res.status).toBe(403);
  });

  it('refuses a closed ticket with TICKET_CLOSED', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { status: 'closed' });
    const res = await assign(ctx.admin, ticket.id, ctx.techUser.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TICKET_CLOSED');
  });

  it("returns 404 for another organization's ticket", async () => {
    const ticket = await createTicket(ctx.alice);
    const globexAdmin = await loginAs(USERS.globex.admin.email);
    const res = await assign(globexAdmin, ticket.id, null);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tickets/:id/assign-to-me', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('assigns the ticket to the caller and starts it', async () => {
    const ticket = await createTicket(ctx.alice);

    const res = await ctx.tech.post(`/api/tickets/${ticket.id}/assign-to-me`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ assignee_id: ctx.techUser.id, status: 'in_progress' });
    expect((await eventsFor(ticket.id)).map((e) => e.field)).toEqual([
      'created',
      'assignee',
      'status',
    ]);
  });

  it('is staff only', async () => {
    const ticket = await createTicket(ctx.alice);
    const res = await ctx.alice.post(`/api/tickets/${ticket.id}/assign-to-me`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/tickets/:id/priority', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  const setPriority = (agent, ticketId, priority) =>
    agent.patch(`/api/tickets/${ticketId}/priority`).send({ priority });

  it('changes the priority and writes an event', async () => {
    const ticket = await createTicket(ctx.alice, { priority: 'low' });

    const res = await setPriority(ctx.tech, ticket.id, 'critical');

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('critical');
    const events = await eventsFor(ticket.id);
    expect(events.find((e) => e.field === 'priority')).toEqual({
      actor_id: ctx.techUser.id,
      field: 'priority',
      old_value: 'low',
      new_value: 'critical',
    });
    // The SLA deadline events that follow it are covered in sla.test.js.
    expect(events.map((e) => e.field)).toEqual([
      'created',
      'priority',
      'response_due_at',
      'resolution_due_at',
    ]);
  });

  it('writes nothing when the priority is unchanged', async () => {
    const ticket = await createTicket(ctx.alice, { priority: 'high' });
    const res = await setPriority(ctx.tech, ticket.id, 'high');
    expect(res.status).toBe(200);
    expect(await eventsFor(ticket.id)).toHaveLength(1);
  });

  it('is staff only, and rejects unknown priorities and closed tickets', async () => {
    const ticket = await createTicket(ctx.alice);
    expect((await setPriority(ctx.alice, ticket.id, 'high')).status).toBe(403);

    const invalid = await setPriority(ctx.tech, ticket.id, 'urgent');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    await setTicketColumns(ticket.id, { status: 'closed' });
    const closed = await setPriority(ctx.tech, ticket.id, 'high');
    expect(closed.status).toBe(400);
    expect(closed.body.error.code).toBe('TICKET_CLOSED');
  });
});
