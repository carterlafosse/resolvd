// Tests for the date helpers: relative wording and the compact SLA durations.
import { describe, expect, it } from 'vitest';
import { fromNow, shortDuration } from './dates.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const minutes = (n) => new Date(NOW.getTime() + n * 60 * 1000);

describe('fromNow', () => {
  it('reads naturally in both directions', () => {
    expect(fromNow(minutes(-180), NOW)).toBe('3 hours ago');
    expect(fromNow(minutes(2 * 24 * 60), NOW)).toBe('in 2 days');
  });
});

describe('shortDuration', () => {
  it('uses compact units', () => {
    expect(shortDuration(minutes(25), NOW)).toBe('25m');
    expect(shortDuration(minutes(-120), NOW)).toBe('2h');
    expect(shortDuration(minutes(3 * 24 * 60), NOW)).toBe('3d');
  });

  it('leaves the default wording alone', () => {
    shortDuration(minutes(25), NOW);
    expect(fromNow(minutes(25), NOW)).toBe('in 25 minutes');
  });
});
