// Concurrency: many tickets created at the same moment still get unique, consecutive numbers.
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, ownerPool, registerOrg, ticketBody } from '../helpers.js';

afterAll(closePools);

describe('ticket numbers under concurrency', () => {
  it('gives 20 parallel creations by one user 20 unique, consecutive numbers', async () => {
    // A fresh org, so its numbers start at 1001 and nothing else creates tickets in it.
    const { agent, org } = await registerOrg();

    // All 20 requests are in flight at once; the pool runs up to 10 transactions together,
    // so they really do compete for the organization's next_ticket_number.
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => agent.post('/api/tickets').send(ticketBody())),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));
    const numbers = responses.map((r) => r.body.ticket_number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => 1001 + i));

    const { rows } = await ownerPool.query(
      `SELECT o.next_ticket_number,
              (SELECT count(*)::int FROM ticket_events e
               WHERE e.organization_id = o.id AND e.field = 'created') AS created_events
       FROM organizations o WHERE o.id = $1`,
      [org.id],
    );
    expect(rows[0]).toEqual({ next_ticket_number: 1021, created_events: 20 });
  });
});
