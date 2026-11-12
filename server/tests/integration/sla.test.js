// SLAs: deadlines on create and priority change, the sla summary, the breach job, queue filters and policy admin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScheduledSlaCheck, runSlaCheck } from '../../src/jobs/slaChecker.js';
import { DEFAULT_SLA_POLICIES } from '../../src/modules/organizations/defaults.js';
import {
  closePools,
  createTicket,
  eventsFor,
  ownerPool,
  setTicketColumns,
  setUpOrg,
} from '../helpers.js';

afterAll(closePools);

const MINUTE = 60_000;
const plusMinutes = (iso, minutes) =>
  new Date(new Date(iso).getTime() + minutes * MINUTE).toISOString();
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * MINUTE).toISOString();

async function ticketRow(ticketId) {
  const { rows } = await ownerPool.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  return rows[0];
}

async function breachEvents(ticketId) {
  return (await eventsFor(ticketId)).filter((e) => e.field === 'sla_breach');
}

// The job looks at every org in the test database, so tests only look at their own tickets.
const breachesFor = (breaches, ticketId) => breaches.filter((b) => b.ticket_id === ticketId);

describe('SLA deadlines and summary', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('gives a critical ticket deadlines 1 hour and 4 hours after created_at', async () => {
    const ticket = await createTicket(ctx.tech, { priority: 'critical' });

    expect(ticket.response_due_at).toBe(plusMinutes(ticket.created_at, 60));
    expect(ticket.resolution_due_at).toBe(plusMinutes(ticket.created_at, 240));
    expect(ticket.sla).toEqual({
      response: 'on_track',
      resolution: 'on_track',
      overall: 'on_track',
    });
  });

  it("uses the org's policy for each priority", async () => {
    for (const policy of DEFAULT_SLA_POLICIES) {
      const ticket = await createTicket(ctx.tech, { priority: policy.priority });
      expect(ticket.response_due_at).toBe(plusMinutes(ticket.created_at, policy.responseMinutes));
      expect(ticket.resolution_due_at).toBe(
        plusMinutes(ticket.created_at, policy.resolutionMinutes),
      );
    }
  });

  it('includes the sla summary in the list and the detail', async () => {
    const ticket = await createTicket(ctx.alice);

    const detail = await ctx.alice.get(`/api/tickets/${ticket.id}`);
    expect(detail.body.sla).toEqual({
      response: 'on_track',
      resolution: 'on_track',
      overall: 'on_track',
    });

    const list = await ctx.tech.get('/api/tickets');
    expect(list.body.data.length).toBeGreaterThan(0);
    for (const row of list.body.data) {
      expect(row.sla).toEqual({
        response: expect.any(String),
        resolution: expect.any(String),
        overall: expect.any(String),
      });
    }
  });

  it('recalculates both deadlines from created_at on a priority change, with events', async () => {
    const ticket = await createTicket(ctx.alice, { priority: 'low' });
    // Created two hours ago, so a deadline wrongly counted from "now" would show.
    const createdAt = minutesFromNow(-120);
    await setTicketColumns(ticket.id, {
      created_at: createdAt,
      response_due_at: plusMinutes(createdAt, 1440),
      resolution_due_at: plusMinutes(createdAt, 7200),
    });

    const res = await ctx.tech
      .patch(`/api/tickets/${ticket.id}/priority`)
      .send({ priority: 'critical' });

    expect(res.status).toBe(200);
    expect(res.body.response_due_at).toBe(plusMinutes(createdAt, 60));
    expect(res.body.resolution_due_at).toBe(plusMinutes(createdAt, 240));
    // No reply after 2 hours against a 1-hour response deadline; 2 of 4 hours left to resolve.
    expect(res.body.sla).toEqual({
      response: 'breached',
      resolution: 'on_track',
      overall: 'breached',
    });
    expect((await eventsFor(ticket.id)).slice(1)).toEqual([
      { actor_id: ctx.techUser.id, field: 'priority', old_value: 'low', new_value: 'critical' },
      {
        actor_id: ctx.techUser.id,
        field: 'response_due_at',
        old_value: plusMinutes(createdAt, 1440),
        new_value: plusMinutes(createdAt, 60),
      },
      {
        actor_id: ctx.techUser.id,
        field: 'resolution_due_at',
        old_value: plusMinutes(createdAt, 7200),
        new_value: plusMinutes(createdAt, 240),
      },
    ]);
  });

  it('marks the response met by the first public staff reply', async () => {
    const ticket = await createTicket(ctx.alice);
    await ctx.tech.post(`/api/tickets/${ticket.id}/comments`).send({ body: 'Looking into it.' });

    const res = await ctx.alice.get(`/api/tickets/${ticket.id}`);
    expect(res.body.sla).toEqual({ response: 'met', resolution: 'on_track', overall: 'on_track' });
  });

  it('counts resolving as the first response when nobody replied first', async () => {
    const ticket = await createTicket(ctx.alice);

    const res = await ctx.tech
      .patch(`/api/tickets/${ticket.id}/status`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.first_response_at).toBe(res.body.resolved_at);
    expect(res.body.sla).toEqual({ response: 'met', resolution: 'met', overall: 'met' });
  });

  it('keeps an earlier reply as the first response when resolving', async () => {
    const ticket = await createTicket(ctx.alice);
    const reply = await ctx.tech
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'Try restarting it.' });

    const res = await ctx.tech
      .patch(`/api/tickets/${ticket.id}/status`)
      .send({ status: 'resolved' });

    expect(res.body.first_response_at).toBe(reply.body.created_at);
  });
});

describe('SLA breach job', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  it('records a breach once, however many times it runs', async () => {
    const ticket = await createTicket(ctx.alice, { priority: 'high' });
    await ctx.tech.post(`/api/tickets/${ticket.id}/comments`).send({ body: 'On it.' });
    await setTicketColumns(ticket.id, { resolution_due_at: minutesFromNow(-10) });

    const first = await runSlaCheck();
    expect(breachesFor(first, ticket.id)).toEqual([
      { ticket_id: ticket.id, org_id: ctx.org.id, clock: 'resolution' },
    ]);

    const second = await runSlaCheck();
    expect(breachesFor(second, ticket.id)).toEqual([]);

    expect(await breachEvents(ticket.id)).toEqual([
      { actor_id: null, field: 'sla_breach', old_value: null, new_value: 'resolution' },
    ]);
    const row = await ticketRow(ticket.id);
    expect(row.resolution_breached_at).toBeInstanceOf(Date);
    expect(row.response_breached_at).toBeNull();
  });

  it('records each clock separately, both in one run', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, {
      response_due_at: minutesFromNow(-20),
      resolution_due_at: minutesFromNow(-10),
    });

    const breaches = breachesFor(await runSlaCheck(), ticket.id);

    expect(breaches.map((b) => b.clock)).toEqual(['response', 'resolution']);
    expect((await breachEvents(ticket.id)).map((e) => e.new_value)).toEqual([
      'response',
      'resolution',
    ]);
  });

  it('records a reply that came after the deadline as a breach', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, {
      response_due_at: minutesFromNow(-30),
      first_response_at: minutesFromNow(-5),
    });

    expect(breachesFor(await runSlaCheck(), ticket.id)).toEqual([
      { ticket_id: ticket.id, org_id: ctx.org.id, clock: 'response' },
    ]);
  });

  it('leaves met clocks, running clocks and tickets without deadlines alone', async () => {
    const met = await createTicket(ctx.alice);
    await setTicketColumns(met.id, {
      status: 'resolved',
      first_response_at: minutesFromNow(-50),
      resolved_at: minutesFromNow(-40),
      response_due_at: minutesFromNow(-30),
      resolution_due_at: minutesFromNow(-20),
    });
    const running = await createTicket(ctx.alice);
    const noDeadlines = await createTicket(ctx.alice);
    await setTicketColumns(noDeadlines.id, { response_due_at: null, resolution_due_at: null });

    const breaches = await runSlaCheck();

    for (const ticket of [met, running, noDeadlines]) {
      expect(breachesFor(breaches, ticket.id)).toEqual([]);
      expect(await breachEvents(ticket.id)).toEqual([]);
    }
  });

  it('records a breach once even when two checks run at the same time', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { response_due_at: minutesFromNow(-1) });

    const [a, b] = await Promise.all([runSlaCheck(), runSlaCheck()]);

    expect([...breachesFor(a, ticket.id), ...breachesFor(b, ticket.id)]).toHaveLength(1);
    expect(await breachEvents(ticket.id)).toHaveLength(1);
  });

  it('shows the breach in the staff history as System, and not to the requester', async () => {
    const ticket = await createTicket(ctx.alice);
    await setTicketColumns(ticket.id, { response_due_at: minutesFromNow(-1) });
    await runSlaCheck();

    const staff = await ctx.tech.get(`/api/tickets/${ticket.id}/events`);
    expect(staff.body.data[0]).toMatchObject({
      actor_id: null,
      actor_name: 'System',
      field: 'sla_breach',
      new_value: 'response',
    });
    const requester = await ctx.alice.get(`/api/tickets/${ticket.id}/events`);
    expect(requester.body.data.map((e) => e.field)).not.toContain('sla_breach');
  });

  it('clears a recorded breach when a priority change moves the deadline into the future', async () => {
    const ticket = await createTicket(ctx.tech, { priority: 'critical' });
    // Created 2 hours ago: the critical 1-hour response deadline has passed.
    const createdAt = minutesFromNow(-120);
    await setTicketColumns(ticket.id, {
      created_at: createdAt,
      response_due_at: plusMinutes(createdAt, 60),
      resolution_due_at: plusMinutes(createdAt, 240),
    });
    expect(breachesFor(await runSlaCheck(), ticket.id)).toHaveLength(1);

    // Low priority: response due a day after creation, so no longer breached.
    await ctx.tech.patch(`/api/tickets/${ticket.id}/priority`).send({ priority: 'low' });

    expect((await ticketRow(ticket.id)).response_breached_at).toBeNull();
    expect(breachesFor(await runSlaCheck(), ticket.id)).toEqual([]);
    // The history still shows the breach that happened.
    expect(await breachEvents(ticket.id)).toHaveLength(1);
  });

  it('keeps a recorded breach when the new deadline has passed too', async () => {
    const ticket = await createTicket(ctx.tech, { priority: 'high' });
    // Created 5 hours ago: both the high (4 h) and critical (1 h) response deadlines passed.
    const createdAt = minutesFromNow(-300);
    await setTicketColumns(ticket.id, {
      created_at: createdAt,
      response_due_at: plusMinutes(createdAt, 240),
      resolution_due_at: plusMinutes(createdAt, 1440),
    });
    await runSlaCheck();

    await ctx.tech.patch(`/api/tickets/${ticket.id}/priority`).send({ priority: 'critical' });

    expect((await ticketRow(ticket.id)).response_breached_at).toBeInstanceOf(Date);
    // The critical resolution deadline (4 h) has passed as well: that's a new breach.
    expect(breachesFor(await runSlaCheck(), ticket.id)).toEqual([
      { ticket_id: ticket.id, org_id: ctx.org.id, clock: 'resolution' },
    ]);
    expect((await breachEvents(ticket.id)).map((e) => e.new_value)).toEqual([
      'response',
      'resolution',
    ]);
  });

  it('skips a scheduled check while the previous one is still running', async () => {
    const results = await Promise.all([runScheduledSlaCheck(), runScheduledSlaCheck()]);
    expect(results).toEqual(['done', 'skipped']);
    // Once the first finishes, the next scheduled check runs normally.
    expect(await runScheduledSlaCheck()).toBe('done');
  });
});

describe('GET /api/tickets?sla=', () => {
  let ctx;
  const t = {};
  beforeAll(async () => {
    ctx = await setUpOrg();
    const make = async (name, columns) => {
      t[name] = await createTicket(ctx.alice);
      if (columns) await setTicketColumns(t[name].id, columns);
    };
    // Each ticket below is created "now"; columns shift its clocks into the state it's named for.
    await make('onTrack');
    // 1,000-minute resolution window with 100 minutes left (10%); response already met.
    await make('resolutionAtRisk', {
      created_at: minutesFromNow(-900),
      first_response_at: minutesFromNow(-890),
      response_due_at: minutesFromNow(-500),
      resolution_due_at: minutesFromNow(100),
    });
    // 60-minute response window with 5 minutes left, no reply yet; resolution far off.
    await make('responseAtRisk', {
      created_at: minutesFromNow(-55),
      response_due_at: minutesFromNow(5),
      resolution_due_at: minutesFromNow(3000),
    });
    // No reply by the response deadline.
    await make('responseBreached', {
      created_at: minutesFromNow(-120),
      response_due_at: minutesFromNow(-60),
    });
    // Resolved, but after the deadline: still breached, even though it's done.
    await make('resolvedLate', {
      status: 'resolved',
      created_at: minutesFromNow(-300),
      first_response_at: minutesFromNow(-290),
      response_due_at: minutesFromNow(-240),
      resolution_due_at: minutesFromNow(-60),
      resolved_at: minutesFromNow(-30),
    });
    // Resolved in time, with its deadline now behind it: met, so in neither filter.
    await make('resolvedInTime', {
      status: 'resolved',
      created_at: minutesFromNow(-300),
      first_response_at: minutesFromNow(-290),
      response_due_at: minutesFromNow(-240),
      resolution_due_at: minutesFromNow(-60),
      resolved_at: minutesFromNow(-90),
    });
    await make('noDeadlines', { response_due_at: null, resolution_due_at: null });
  });

  const names = (res) =>
    res.body.data.map((row) => Object.keys(t).find((name) => t[name].id === row.id)).sort();

  it('sla=breached returns the tickets with a breached clock', async () => {
    const res = await ctx.tech.get('/api/tickets?sla=breached');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['resolvedLate', 'responseBreached']);
    expect(res.body.data.every((row) => row.sla.overall === 'breached')).toBe(true);
  });

  it('sla=at_risk returns unbreached tickets with a clock in its last 25%', async () => {
    const res = await ctx.tech.get('/api/tickets?sla=at_risk');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['resolutionAtRisk', 'responseAtRisk']);
    expect(res.body.data.every((row) => row.sla.overall === 'at_risk')).toBe(true);
  });

  it('matches the sla summary of every ticket in the queue', async () => {
    const all = (await ctx.tech.get('/api/tickets?pageSize=100')).body.data;
    expect(all).toHaveLength(Object.keys(t).length);
    for (const filter of ['breached', 'at_risk']) {
      const filtered = (await ctx.tech.get(`/api/tickets?sla=${filter}&pageSize=100`)).body.data;
      expect(filtered.map((row) => row.id).sort()).toEqual(
        all
          .filter((row) => row.sla.overall === filter)
          .map((row) => row.id)
          .sort(),
      );
    }
  });

  it('combines with other filters and still applies the end user visibility rule', async () => {
    const resolvedOnly = await ctx.tech.get('/api/tickets?sla=breached&status=resolved');
    expect(names(resolvedOnly)).toEqual(['resolvedLate']);

    // Every ticket here is Alice's, so Bob sees none of them.
    expect((await ctx.bob.get('/api/tickets?sla=breached')).body.data).toEqual([]);
    expect(names(await ctx.alice.get('/api/tickets?sla=breached'))).toEqual([
      'resolvedLate',
      'responseBreached',
    ]);
  });

  it('rejects an unknown sla filter', async () => {
    const res = await ctx.tech.get('/api/tickets?sla=late');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('/api/sla-policies', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setUpOrg();
  });

  const put = (agent, priority, body) => agent.put(`/api/sla-policies/${priority}`).send(body);

  it("lists the org's four policies for staff, most urgent first", async () => {
    const res = await ctx.tech.get('/api/sla-policies');

    expect(res.status).toBe(200);
    expect(
      res.body.data.map(({ priority, response_minutes, resolution_minutes }) => ({
        priority,
        responseMinutes: response_minutes,
        resolutionMinutes: resolution_minutes,
      })),
    ).toEqual(DEFAULT_SLA_POLICIES);
    expect(res.body.data[0]).toHaveProperty('updated_at');
  });

  it("doesn't list policies for end users (403)", async () => {
    expect((await ctx.alice.get('/api/sla-policies')).status).toBe(403);
  });

  it('lets an admin update a policy', async () => {
    const res = await put(ctx.admin, 'low', { responseMinutes: 720, resolutionMinutes: 4320 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      priority: 'low',
      response_minutes: 720,
      resolution_minutes: 4320,
    });
    const listed = (await ctx.tech.get('/api/sla-policies')).body.data;
    expect(listed.find((p) => p.priority === 'low')).toMatchObject({
      response_minutes: 720,
      resolution_minutes: 4320,
    });
  });

  it('refuses updates from technicians and end users (403)', async () => {
    const body = { responseMinutes: 30, resolutionMinutes: 120 };
    expect((await put(ctx.tech, 'critical', body)).status).toBe(403);
    expect((await put(ctx.alice, 'critical', body)).status).toBe(403);
  });

  it.each([
    [
      'response equal to resolution',
      { responseMinutes: 60, resolutionMinutes: 60 },
      'resolutionMinutes',
    ],
    [
      'response longer than resolution',
      { responseMinutes: 120, resolutionMinutes: 60 },
      'resolutionMinutes',
    ],
    ['under 5 minutes', { responseMinutes: 4, resolutionMinutes: 60 }, 'responseMinutes'],
    ['over 90 days', { responseMinutes: 60, resolutionMinutes: 129_601 }, 'resolutionMinutes'],
    ['not whole minutes', { responseMinutes: 30.5, resolutionMinutes: 60 }, 'responseMinutes'],
    ['as text', { responseMinutes: '30', resolutionMinutes: 60 }, 'responseMinutes'],
    ['missing', { responseMinutes: 30 }, 'resolutionMinutes'],
  ])('rejects a policy with times %s (400)', async (_, body, field) => {
    const res = await put(ctx.admin, 'high', body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fieldErrors).toHaveProperty(field);
  });

  it('accepts the limits: 5 minutes and 90 days', async () => {
    const res = await put(ctx.admin, 'medium', { responseMinutes: 5, resolutionMinutes: 129_600 });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown priority (400)', async () => {
    const res = await put(ctx.admin, 'urgent', { responseMinutes: 30, resolutionMinutes: 60 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("changes only the admin's own org", async () => {
    const other = await setUpOrg();
    await put(ctx.admin, 'critical', { responseMinutes: 15, resolutionMinutes: 90 });

    const theirs = (await other.tech.get('/api/sla-policies')).body.data;
    expect(theirs.find((p) => p.priority === 'critical')).toMatchObject({
      response_minutes: 60,
      resolution_minutes: 240,
    });
  });

  it('applies to new tickets only; existing tickets keep their deadlines', async () => {
    const before = await createTicket(ctx.tech, { priority: 'high' });

    await put(ctx.admin, 'high', { responseMinutes: 30, resolutionMinutes: 300 });
    const after = await createTicket(ctx.tech, { priority: 'high' });

    const unchanged = (await ctx.tech.get(`/api/tickets/${before.id}`)).body;
    expect(unchanged.response_due_at).toBe(before.response_due_at);
    expect(unchanged.resolution_due_at).toBe(before.resolution_due_at);
    expect(after.response_due_at).toBe(plusMinutes(after.created_at, 30));
    expect(after.resolution_due_at).toBe(plusMinutes(after.created_at, 300));
  });
});
