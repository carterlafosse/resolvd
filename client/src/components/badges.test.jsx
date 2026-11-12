// Tests for the shared badges: labels from constants.js, the SLA wording and the clock choice.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders.jsx';
import { PriorityBadge } from './PriorityBadge.jsx';
import { overallClock, slaLabel } from './sla.js';
import { StatusBadge } from './StatusBadge.jsx';

const NOW = new Date('2026-11-12T12:00:00Z');
const inMinutes = (n) => new Date(NOW.getTime() + n * 60 * 1000).toISOString();

describe('slaLabel', () => {
  it('words each state the way the queue shows it', () => {
    expect(slaLabel('on_track', inMinutes(120), NOW)).toBe('Due in 2h');
    expect(slaLabel('at_risk', inMinutes(25), NOW)).toBe('At risk, 25m left');
    expect(slaLabel('breached', inMinutes(-60), NOW)).toBe('Breached 1h ago');
    expect(slaLabel('met', inMinutes(-60), NOW)).toBe('Met');
    expect(slaLabel('none', null, NOW)).toBe('No SLA');
  });
});

describe('overallClock', () => {
  const ticket = (response, resolution, overall) => ({
    sla: { response, resolution, overall },
    response_due_at: inMinutes(60),
    resolution_due_at: inMinutes(240),
  });

  it('picks the clock that decided the overall state', () => {
    expect(overallClock(ticket('met', 'on_track', 'on_track'))).toMatchObject({
      name: 'Resolution',
      dueAt: inMinutes(240),
    });
    expect(overallClock(ticket('breached', 'on_track', 'breached')).name).toBe('Response');
  });

  it('picks the earlier deadline when both clocks share the state', () => {
    expect(overallClock(ticket('on_track', 'on_track', 'on_track')).name).toBe('Response');
  });

  it('falls back to no SLA', () => {
    expect(overallClock({})).toEqual({ name: null, state: 'none', dueAt: null });
  });
});

describe('StatusBadge and PriorityBadge', () => {
  it('show the labels from constants.js', () => {
    renderWithProviders(
      <>
        <StatusBadge status="in_progress" />
        <PriorityBadge priority="critical" />
      </>,
    );
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Critical')).toBeTruthy();
  });
});
