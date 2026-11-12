// Tests for the queue filters: URL parsing, defaults, the API query and the "Showing" text.
import { describe, expect, it } from 'vitest';
import {
  hasFilters,
  readQueueState,
  showingText,
  toApiFilters,
  updateParams,
} from './queueFilters.js';

const params = (text) => new URLSearchParams(text);

describe('readQueueState', () => {
  it('defaults staff to My tickets, soonest deadline first', () => {
    const state = readQueueState(params(''), true);
    expect(state.tab.value).toBe('mine');
    expect(state).toMatchObject({ sort: 'resolution_due_at', order: 'asc', page: 1 });
  });

  it('defaults end users to Open, newest first', () => {
    const state = readQueueState(params(''), false);
    expect(state.tab.value).toBe('open');
    expect(state).toMatchObject({ sort: 'created_at', order: 'desc' });
  });

  it('reads filters from the URL and drops values that are not allowed', () => {
    const state = readQueueState(
      params('tab=open&status=on_hold,closed,bogus&priority=high,urgent&q=printer&page=3'),
      true,
    );
    // closed isn't one of the "All open" tab's statuses.
    expect(state.statuses).toEqual(['on_hold']);
    expect(state.priorities).toEqual(['high']);
    expect(state.search).toBe('printer');
    expect(state.page).toBe(3);
  });

  it('falls back on unknown tabs, sorts and pages', () => {
    const state = readQueueState(params('tab=nope&sort=title;DROP&order=up&page=-2'), true);
    expect(state.tab.value).toBe('mine');
    expect(state).toMatchObject({ sort: 'resolution_due_at', order: 'asc', page: 1 });
  });

  it("uses a column's own default order when only the sort is given", () => {
    expect(readQueueState(params('sort=updated_at'), true).order).toBe('desc');
  });
});

describe('toApiFilters', () => {
  it("sends the tab's filters and statuses when the status filter is empty", () => {
    const filters = toApiFilters(readQueueState(params('tab=unassigned'), true));
    expect(filters).toMatchObject({
      assignee: 'unassigned',
      status: ['open', 'in_progress', 'on_hold'],
      page: 1,
      pageSize: 25,
    });
  });

  it('narrows to the selected statuses', () => {
    const filters = toApiFilters(readQueueState(params('tab=breached&status=on_hold'), true));
    expect(filters).toMatchObject({ sla: 'breached', status: ['on_hold'] });
  });

  it('sends no status filter for the All tickets tab', () => {
    expect(toApiFilters(readQueueState(params('tab=all'), true)).status).toBeUndefined();
  });

  it('gives end users their open tickets including resolved ones, or closed ones', () => {
    expect(toApiFilters(readQueueState(params(''), false)).status).toEqual([
      'open',
      'in_progress',
      'on_hold',
      'resolved',
    ]);
    expect(toApiFilters(readQueueState(params('tab=closed'), false)).status).toEqual(['closed']);
  });
});

describe('hasFilters', () => {
  it('is true only when the filter bar narrows the tab', () => {
    expect(hasFilters(readQueueState(params('tab=all'), true))).toBe(false);
    expect(hasFilters(readQueueState(params('q=%20%20'), true))).toBe(false);
    expect(hasFilters(readQueueState(params('priority=low'), true))).toBe(true);
  });
});

describe('updateParams', () => {
  it('resets the page when a filter changes, and removes empty values', () => {
    const next = updateParams(params('tab=all&page=4&q=vpn'), { priority: ['high'], q: '' });
    expect(next.toString()).toBe('tab=all&priority=high');
  });

  it('keeps other params when only the page changes', () => {
    expect(updateParams(params('tab=all&q=vpn'), { page: 2 }).toString()).toBe(
      'tab=all&q=vpn&page=2',
    );
  });
});

describe('showingText', () => {
  it('describes the current page', () => {
    expect(showingText({ page: 2, pageSize: 25, total: 132 })).toBe('Showing 26 to 50 of 132');
    expect(showingText({ page: 6, pageSize: 25, total: 132 })).toBe('Showing 126 to 132 of 132');
    expect(showingText({ page: 1, pageSize: 25, total: 0 })).toBe('No tickets');
  });
});
