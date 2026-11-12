// Tests for the activity feed's event sentences.
import { describe, expect, it } from 'vitest';
import { describeEvent } from './activityText.js';

const event = (field, old_value, new_value, actor_name = 'Tess Tech') => ({
  actor_name,
  field,
  old_value,
  new_value,
});

describe('describeEvent', () => {
  it('uses labels for statuses and priorities', () => {
    expect(describeEvent(event('status', 'open', 'in_progress'))).toBe(
      'Tess Tech changed the status from Open to In progress',
    );
    expect(describeEvent(event('priority', 'medium', 'critical'))).toBe(
      'Tess Tech changed the priority from Medium to Critical',
    );
  });

  it('words assigning, unassigning and reassigning differently', () => {
    expect(describeEvent(event('assignee', 'Unassigned', 'Tess Tech'))).toBe(
      'Tess Tech assigned the ticket to Tess Tech',
    );
    expect(describeEvent(event('assignee', 'Tess Tech', 'Unassigned'))).toBe(
      'Tess Tech unassigned Tess Tech',
    );
    expect(describeEvent(event('assignee', 'Tess Tech', 'Sam Admin'))).toBe(
      'Tess Tech reassigned the ticket from Tess Tech to Sam Admin',
    );
  });

  it('describes creation, edits and empty categories', () => {
    expect(describeEvent(event('created', null, 'open', 'Alice'))).toBe('Alice created the ticket');
    expect(describeEvent(event('title', 'Old', 'New title'))).toBe(
      'Tess Tech renamed the ticket to "New title"',
    );
    expect(describeEvent(event('category', null, 'Hardware'))).toBe(
      'Tess Tech changed the category from None to Hardware',
    );
  });

  it('describes system events without an actor', () => {
    expect(describeEvent(event('sla_breach', null, 'response', 'System'))).toBe(
      'Response SLA breached',
    );
    expect(describeEvent(event('resolution_due_at', null, null))).toBe(
      'Resolution deadline changed to none',
    );
  });
});
