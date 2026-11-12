// Ticket schemas and pure rule helpers: parsing the list query, update bodies, visibility and priority.
import { describe, expect, it } from 'vitest';
import {
  createTicketSchema,
  listTicketsQuery,
  ticketIdParams,
  updateTicketSchema,
} from '../../src/modules/tickets/tickets.schemas.js';
import {
  allowedActions,
  assertCanSetPriority,
  canComment,
  canEdit,
  canView,
  parseTicketSearch,
} from '../../src/modules/tickets/tickets.service.js';

const endUser = { id: 10, role: 'end_user' };
const technician = { id: 20, role: 'technician' };
const admin = { id: 30, role: 'admin' };

describe('listTicketsQuery', () => {
  it('applies defaults', () => {
    expect(listTicketsQuery.parse({})).toEqual({
      sort: 'created_at',
      order: 'desc',
      page: 1,
      pageSize: 25,
    });
  });

  it('splits comma-separated statuses and priorities', () => {
    const q = listTicketsQuery.parse({ status: 'open, in_progress', priority: 'high,critical' });
    expect(q.status).toEqual(['open', 'in_progress']);
    expect(q.priority).toEqual(['high', 'critical']);
  });

  it.each([
    [{ status: 'open,bogus' }],
    [{ status: '' }],
    [{ priority: 'urgent' }],
    [{ sort: 'title;DROP TABLE tickets' }],
    [{ sort: 'title' }],
    [{ order: 'sideways' }],
    [{ page: '0' }],
    [{ pageSize: '101' }],
    [{ assignee: 'someone' }],
    [{ assignee: '0' }],
    [{ assignee: '99999999999' }],
    [{ categoryId: 'abc' }],
    [{ search: 'x'.repeat(101) }],
    [{ sla: 'late' }],
  ])('rejects %j', (query) => {
    expect(listTicketsQuery.safeParse(query).success).toBe(false);
  });

  it('accepts assignee me, unassigned or a numeric id', () => {
    expect(listTicketsQuery.parse({ assignee: 'me' }).assignee).toBe('me');
    expect(listTicketsQuery.parse({ assignee: 'unassigned' }).assignee).toBe('unassigned');
    expect(listTicketsQuery.parse({ assignee: '42' }).assignee).toBe(42);
  });

  it('treats an empty search as no search', () => {
    expect(listTicketsQuery.parse({ search: '   ' }).search).toBeUndefined();
  });
});

describe('ticket bodies', () => {
  it('defaults priority to medium on create and trims text', () => {
    const body = createTicketSchema.parse({
      title: '  Printer jam  ',
      description: 'The second floor printer is jammed again.',
    });
    expect(body).toMatchObject({ title: 'Printer jam', priority: 'medium' });
  });

  it('rejects a title that is only long enough because of spaces', () => {
    const result = createTicketSchema.safeParse({
      title: '  abc   ',
      description: 'A long enough description.',
    });
    expect(result.success).toBe(false);
  });

  it('does not add a default priority on update', () => {
    expect(updateTicketSchema.parse({ title: 'New title here' })).toEqual({
      title: 'New title here',
    });
  });

  it('needs at least one field besides expectedUpdatedAt', () => {
    expect(updateTicketSchema.safeParse({}).success).toBe(false);
    expect(
      updateTicketSchema.safeParse({ expectedUpdatedAt: '2026-11-12T10:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('accepts null to clear the category', () => {
    expect(updateTicketSchema.parse({ categoryId: null })).toEqual({ categoryId: null });
  });

  it('rejects ids outside the INT range', () => {
    expect(ticketIdParams.safeParse({ id: '2147483648' }).success).toBe(false);
    expect(ticketIdParams.parse({ id: '2147483647' }).id).toBe(2147483647);
  });
});

describe('canView', () => {
  it('lets staff see any ticket and end users only their own', () => {
    const ticket = { requester_id: 10 };
    expect(canView(technician, ticket)).toBe(true);
    expect(canView(admin, ticket)).toBe(true);
    expect(canView(endUser, ticket)).toBe(true);
    expect(canView({ id: 11, role: 'end_user' }, ticket)).toBe(false);
  });
});

describe('assertCanSetPriority', () => {
  it('allows critical only for staff', () => {
    expect(() => assertCanSetPriority(endUser, 'critical')).toThrow(/staff/);
    expect(() => assertCanSetPriority(endUser, 'high')).not.toThrow();
    expect(() => assertCanSetPriority(technician, 'critical')).not.toThrow();
  });
});

describe('parseTicketSearch', () => {
  it.each([
    ['RES-1003', 1003],
    ['res-1003', 1003],
    ['1003', 1003],
    [' RES-42 ', 42],
  ])('reads %j as ticket number %i', (search, number) => {
    expect(parseTicketSearch(search).ticketNumber).toBe(number);
  });

  it.each(['printer', 'RES-', 'RES-12a', 'RES-99999999999'])(
    'does not treat %j as a ticket number',
    (search) => {
      expect(parseTicketSearch(search).ticketNumber).toBeNull();
    },
  );

  it('escapes LIKE wildcards so they match literally', () => {
    expect(parseTicketSearch('100%_done\\').titlePattern).toBe('%100\\%\\_done\\\\%');
  });
});

describe('canEdit and canComment', () => {
  const ticket = (status) => ({ status, requester_id: endUser.id, resolved_at: null });

  it('lets the requester edit only while the ticket is open', () => {
    expect(canEdit(endUser, ticket('open'))).toBe(true);
    for (const status of ['in_progress', 'on_hold', 'resolved', 'closed']) {
      expect(canEdit(endUser, ticket(status))).toBe(false);
    }
  });

  it('lets staff edit at any status except closed', () => {
    for (const user of [technician, admin]) {
      for (const status of ['open', 'in_progress', 'on_hold', 'resolved']) {
        expect(canEdit(user, ticket(status))).toBe(true);
      }
      expect(canEdit(user, ticket('closed'))).toBe(false);
    }
  });

  it('allows comments until the ticket is closed', () => {
    for (const status of ['open', 'in_progress', 'on_hold', 'resolved']) {
      expect(canComment(ticket(status))).toBe(true);
    }
    expect(canComment(ticket('closed'))).toBe(false);
  });

  it('allowedActions combines all three for the viewer', () => {
    expect(allowedActions(endUser, ticket('open'))).toEqual({
      allowedTransitions: [],
      canEdit: true,
      canComment: true,
    });
    expect(allowedActions(technician, ticket('open'))).toEqual({
      allowedTransitions: ['in_progress', 'on_hold', 'resolved'],
      canEdit: true,
      canComment: true,
    });
  });
});
