// SLA calculations: due dates from a policy, every clock state and its boundaries, and the summary.
import { describe, expect, it } from 'vitest';
import {
  AT_RISK_SHARE,
  clockState,
  computeDueDates,
  slaSummary,
  withSla,
} from '../../src/modules/sla/sla.js';
import { DEFAULT_SLA_POLICIES } from '../../src/modules/organizations/defaults.js';

const MINUTE = 60 * 1000;
const START = new Date('2026-06-15T12:00:00Z');
const at = (minutes) => new Date(START.getTime() + minutes * MINUTE);

describe('computeDueDates', () => {
  it('counts both deadlines from created_at in calendar minutes', () => {
    const critical = DEFAULT_SLA_POLICIES.find((p) => p.priority === 'critical');
    expect(computeDueDates(START, critical)).toEqual({
      responseDueAt: new Date('2026-06-15T13:00:00Z'),
      resolutionDueAt: new Date('2026-06-15T16:00:00Z'),
    });
  });

  it('ignores weekends and nights (24/7 time)', () => {
    // Friday 17:00 + 5 days (low priority resolution) is the next Wednesday 17:00.
    const friday = new Date('2026-06-19T17:00:00Z');
    const low = DEFAULT_SLA_POLICIES.find((p) => p.priority === 'low');
    expect(computeDueDates(friday, low).resolutionDueAt).toEqual(new Date('2026-06-24T17:00:00Z'));
  });

  it('accepts an ISO string as well as a Date', () => {
    const policy = { responseMinutes: 30, resolutionMinutes: 90 };
    expect(computeDueDates(START.toISOString(), policy)).toEqual(computeDueDates(START, policy));
  });
});

describe('clockState', () => {
  // A 100-minute window: at risk from minute 75 (less than 25 minutes left).
  const clock = (overrides) =>
    clockState({ startAt: START, dueAt: at(100), completedAt: null, now: at(0), ...overrides });

  it('is none without a deadline', () => {
    expect(clock({ dueAt: null, now: at(500) })).toBe('none');
  });

  it('is on_track while 25% or more of the window is left', () => {
    expect(clock({ now: at(0) })).toBe('on_track');
    expect(clock({ now: at(75) })).toBe('on_track');
  });

  it('is at_risk with less than 25% left, up to and including the deadline', () => {
    expect(AT_RISK_SHARE).toBe(0.25);
    expect(clock({ now: new Date(at(75).getTime() + 1) })).toBe('at_risk');
    expect(clock({ now: at(99) })).toBe('at_risk');
    expect(clock({ now: at(100) })).toBe('at_risk');
  });

  it('is breached once the deadline has passed with the clock still running', () => {
    expect(clock({ now: new Date(at(100).getTime() + 1) })).toBe('breached');
    expect(clock({ now: at(10_000) })).toBe('breached');
  });

  it('is met when completed on or before the deadline, whatever the time now', () => {
    expect(clock({ completedAt: at(10), now: at(5000) })).toBe('met');
    expect(clock({ completedAt: at(100), now: at(5000) })).toBe('met');
  });

  it('is breached when completed after the deadline (late counts as breached)', () => {
    expect(clock({ completedAt: at(101), now: at(5000) })).toBe('breached');
  });

  it('accepts ISO strings', () => {
    expect(
      clockState({
        startAt: START.toISOString(),
        dueAt: at(100).toISOString(),
        completedAt: null,
        now: at(90).toISOString(),
      }),
    ).toBe('at_risk');
  });
});

describe('slaSummary', () => {
  // Response due at minute 60, resolution at minute 240 (the critical policy).
  function ticket(overrides = {}) {
    return {
      created_at: START,
      response_due_at: at(60),
      resolution_due_at: at(240),
      first_response_at: null,
      resolved_at: null,
      ...overrides,
    };
  }

  it('gives a met response plus an on-track resolution as on_track overall', () => {
    expect(slaSummary(ticket({ first_response_at: at(30) }), at(40))).toEqual({
      response: 'met',
      resolution: 'on_track',
      overall: 'on_track',
    });
  });

  it('takes the more severe clock: breached beats everything', () => {
    // No reply after 70 minutes: response breached, resolution still on track.
    expect(slaSummary(ticket(), at(70))).toEqual({
      response: 'breached',
      resolution: 'on_track',
      overall: 'breached',
    });
  });

  it('ranks at_risk above on_track', () => {
    // Minute 50: response at risk (10 of 60 minutes left), resolution on track.
    expect(slaSummary(ticket(), at(50)).overall).toBe('at_risk');
  });

  it('is met overall when both clocks were met', () => {
    const done = ticket({ first_response_at: at(10), resolved_at: at(200) });
    expect(slaSummary(done, at(10_000))).toEqual({
      response: 'met',
      resolution: 'met',
      overall: 'met',
    });
  });

  it('is breached overall when resolved late, even long afterwards', () => {
    const late = ticket({ first_response_at: at(10), resolved_at: at(300) });
    expect(slaSummary(late, at(10_000)).overall).toBe('breached');
  });

  it('is none for a ticket without deadlines', () => {
    const old = ticket({ response_due_at: null, resolution_due_at: null });
    expect(slaSummary(old, at(10))).toEqual({
      response: 'none',
      resolution: 'none',
      overall: 'none',
    });
  });

  it('withSla adds the summary without changing the ticket', () => {
    const t = ticket();
    expect(withSla(t, at(0))).toEqual({
      ...t,
      sla: { response: 'on_track', resolution: 'on_track', overall: 'on_track' },
    });
    expect(t).not.toHaveProperty('sla');
  });
});
