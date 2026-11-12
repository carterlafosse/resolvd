// Ticket status workflow: every from/to pair for staff and requesters, the reopen window and side effects.
import { describe, expect, it } from 'vitest';
import {
  REOPEN_WINDOW_DAYS,
  canTransition,
  isStaff,
  statusChangeEffects,
} from '../../src/modules/tickets/workflow.js';

const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];
const DAY = 24 * 60 * 60 * 1000;

// A fixed clock, so the 7-day window is tested exactly.
const NOW = new Date('2026-06-15T12:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);

const requester = { id: 10, role: 'end_user' };
const otherEndUser = { id: 11, role: 'end_user' };
const technician = { id: 20, role: 'technician' };
const admin = { id: 30, role: 'admin' };

function ticket(status, overrides = {}) {
  return {
    status,
    requester_id: requester.id,
    resolved_at: status === 'resolved' || status === 'closed' ? daysAgo(1) : null,
    ...overrides,
  };
}

// The plan's workflow table, written out as every allowed pair.
const STAFF_ALLOWED = new Set([
  'open>in_progress',
  'open>on_hold',
  'open>resolved',
  'in_progress>on_hold',
  'in_progress>resolved',
  'in_progress>open',
  'on_hold>in_progress',
  'on_hold>resolved',
  'resolved>closed',
  'resolved>open',
]);
const REQUESTER_ALLOWED = new Set(['resolved>closed', 'resolved>open']);

const ALL_PAIRS = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to]));

describe('isStaff', () => {
  it('is true for technicians and admins only', () => {
    expect(isStaff(technician)).toBe(true);
    expect(isStaff(admin)).toBe(true);
    expect(isStaff(requester)).toBe(false);
  });
});

describe('canTransition', () => {
  describe.each([
    ['technician', technician],
    ['admin', admin],
  ])('as a %s', (_, user) => {
    it.each(ALL_PAIRS)('%s -> %s follows the workflow table', (from, to) => {
      const result = canTransition({ ticket: ticket(from), to, user, now: NOW });
      expect(result.ok).toBe(STAFF_ALLOWED.has(`${from}>${to}`));
      // Every refusal says why; an allowed move has no reason.
      expect(result.reason).toEqual(result.ok ? null : expect.any(String));
    });

    it('can reopen a resolved ticket long after the 7-day window', () => {
      const old = ticket('resolved', { resolved_at: daysAgo(365) });
      expect(canTransition({ ticket: old, to: 'open', user, now: NOW }).ok).toBe(true);
    });
  });

  describe('as the requester', () => {
    it.each(ALL_PAIRS)('%s -> %s is allowed only when confirming or reopening', (from, to) => {
      const result = canTransition({ ticket: ticket(from), to, user: requester, now: NOW });
      expect(result.ok).toBe(REQUESTER_ALLOWED.has(`${from}>${to}`));
    });

    it('explains that other changes are for staff', () => {
      const result = canTransition({
        ticket: ticket('open'),
        to: 'resolved',
        user: requester,
        now: NOW,
      });
      expect(result).toEqual({
        ok: false,
        reason: 'Only support staff can change the status of this ticket',
      });
    });
  });

  describe('the requester reopen window', () => {
    const reopen = (resolvedAt) =>
      canTransition({
        ticket: ticket('resolved', { resolved_at: resolvedAt }),
        to: 'open',
        user: requester,
        now: NOW,
      });

    it(`is ${REOPEN_WINDOW_DAYS} days`, () => {
      expect(REOPEN_WINDOW_DAYS).toBe(7);
    });

    it('allows reopening just after resolution and at exactly 7 days', () => {
      expect(reopen(NOW).ok).toBe(true);
      expect(reopen(daysAgo(3)).ok).toBe(true);
      expect(reopen(daysAgo(7)).ok).toBe(true);
    });

    it('refuses one millisecond after 7 days, and at 8 days', () => {
      expect(reopen(new Date(daysAgo(7).getTime() - 1)).ok).toBe(false);
      const result = reopen(daysAgo(8));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/within 7 days/);
    });

    it('accepts resolved_at as an ISO string', () => {
      expect(reopen(daysAgo(2).toISOString()).ok).toBe(true);
    });

    it('refuses when resolved_at is missing', () => {
      expect(reopen(null).ok).toBe(false);
    });

    it('does not limit closing: the requester can confirm a fix at any time', () => {
      const old = ticket('resolved', { resolved_at: daysAgo(30) });
      expect(canTransition({ ticket: old, to: 'closed', user: requester, now: NOW }).ok).toBe(true);
    });
  });

  it('refuses an end user who is not the requester, even on a resolved ticket', () => {
    for (const to of ['closed', 'open']) {
      expect(
        canTransition({ ticket: ticket('resolved'), to, user: otherEndUser, now: NOW }).ok,
      ).toBe(false);
    }
  });

  it('gives clear reasons for closed, unchanged and illegal moves', () => {
    expect(
      canTransition({ ticket: ticket('closed'), to: 'open', user: admin, now: NOW }).reason,
    ).toBe('This ticket is closed. Please submit a new one.');
    expect(
      canTransition({ ticket: ticket('on_hold'), to: 'on_hold', user: admin, now: NOW }).reason,
    ).toBe('The ticket is already on_hold');
    expect(
      canTransition({ ticket: ticket('open'), to: 'closed', user: admin, now: NOW }).reason,
    ).toBe("A ticket can't move from open to closed");
  });

  it('refuses an unknown target status', () => {
    expect(canTransition({ ticket: ticket('open'), to: 'deleted', user: admin, now: NOW }).ok).toBe(
      false,
    );
  });
});

describe('statusChangeEffects', () => {
  it('sets resolved_at when resolving', () => {
    for (const from of ['open', 'in_progress', 'on_hold']) {
      expect(statusChangeEffects({ from, to: 'resolved', now: NOW })).toEqual({ resolvedAt: NOW });
    }
  });

  it('clears resolved_at when a resolved ticket is reopened', () => {
    expect(statusChangeEffects({ from: 'resolved', to: 'open', now: NOW })).toEqual({
      resolvedAt: null,
    });
  });

  it('sets closed_at when closing, keeping resolved_at', () => {
    expect(statusChangeEffects({ from: 'resolved', to: 'closed', now: NOW })).toEqual({
      closedAt: NOW,
    });
  });

  it('changes nothing else for other moves', () => {
    expect(statusChangeEffects({ from: 'open', to: 'in_progress', now: NOW })).toEqual({});
    expect(statusChangeEffects({ from: 'in_progress', to: 'open', now: NOW })).toEqual({});
    expect(statusChangeEffects({ from: 'on_hold', to: 'in_progress', now: NOW })).toEqual({});
  });
});
