// Tests for converting SLA times between minutes and hours or days, and the policy checks.
import { describe, expect, it } from 'vitest';
import { fromMinutes, policyErrors, toMinutes } from './slaUnits.js';

describe('fromMinutes', () => {
  it('shows whole days as days and everything else as hours', () => {
    expect(fromMinutes(4320)).toEqual({ value: 3, unit: 'days' });
    expect(fromMinutes(240)).toEqual({ value: 4, unit: 'hours' });
    expect(fromMinutes(30)).toEqual({ value: 0.5, unit: 'hours' });
    expect(fromMinutes(1500)).toEqual({ value: 25, unit: 'hours' });
  });
});

describe('toMinutes', () => {
  it('converts and rounds to whole minutes', () => {
    expect(toMinutes(4, 'hours')).toBe(240);
    expect(toMinutes(2, 'days')).toBe(2880);
    expect(toMinutes(0.1, 'hours')).toBe(6);
  });

  it('round-trips the default policies', () => {
    for (const minutes of [60, 240, 480, 1440, 4320, 10080]) {
      const { value, unit } = fromMinutes(minutes);
      expect(toMinutes(value, unit)).toBe(minutes);
    }
  });
});

describe('policyErrors', () => {
  it('accepts a response shorter than the resolution', () => {
    expect(policyErrors(60, 240)).toEqual({});
  });

  it('checks the 5 minute to 90 day range', () => {
    expect(policyErrors(4, 240)).toEqual({ response: 'Use 5 minutes to 90 days' });
    expect(policyErrors(60, 90 * 1440 + 1)).toEqual({ resolution: 'Use 5 minutes to 90 days' });
    expect(policyErrors(Number.NaN, 240).response).toBeTruthy();
  });

  it('puts the ordering error on the resolution time, like the API', () => {
    expect(policyErrors(240, 240)).toEqual({
      resolution: 'Must be longer than the response time',
    });
  });
});
