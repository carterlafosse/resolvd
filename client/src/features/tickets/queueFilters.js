// The ticket queue's filters: reading them from the URL, and turning them into the API's query.
// Kept as pure functions so the rules are tested without rendering the page.
import { ACTIVE_STATUSES, PRIORITIES, STATUSES } from '../../constants.js';

const ALL_STATUSES = Object.keys(STATUSES);

// Each tab is a fixed view of the queue. `statuses` are the statuses the tab covers; the
// status filter can only narrow them down.
export const STAFF_TABS = [
  { value: 'mine', label: 'My tickets', filters: { assignee: 'me' }, statuses: ACTIVE_STATUSES },
  {
    value: 'unassigned',
    label: 'Unassigned',
    filters: { assignee: 'unassigned' },
    statuses: ACTIVE_STATUSES,
  },
  { value: 'open', label: 'All open', filters: {}, statuses: ACTIVE_STATUSES },
  { value: 'breached', label: 'Breached', filters: { sla: 'breached' }, statuses: ACTIVE_STATUSES },
  { value: 'all', label: 'All tickets', filters: {}, statuses: ALL_STATUSES },
];

// Resolved tickets stay under Open for end users: they're waiting for the requester to
// confirm the fix.
export const END_USER_TABS = [
  { value: 'open', label: 'Open', filters: {}, statuses: [...ACTIVE_STATUSES, 'resolved'] },
  { value: 'closed', label: 'Closed', filters: {}, statuses: ['closed'] },
];

// Column -> the API's sort value, and the order a first click uses. Deadlines read soonest
// first; dates and priority read newest or most severe first.
export const SORTS = {
  created_at: { defaultOrder: 'desc' },
  priority: { defaultOrder: 'desc' },
  resolution_due_at: { defaultOrder: 'asc' },
  updated_at: { defaultOrder: 'desc' },
};

export const PAGE_SIZE = 25;

export function tabsFor(isStaff) {
  return isStaff ? STAFF_TABS : END_USER_TABS;
}

// Staff work the most urgent deadline first; end users see their newest ticket first.
export function defaultSort(isStaff) {
  return isStaff
    ? { sort: 'resolution_due_at', order: 'asc' }
    : { sort: 'created_at', order: 'desc' };
}

// Comma-separated list from the URL, keeping only values in `allowed`, so a hand-edited or
// outdated link can't send the API something it would reject.
function listParam(params, key, allowed) {
  const raw = params.get(key);
  if (!raw) return [];
  return raw.split(',').filter((value) => allowed.includes(value));
}

// Everything the page needs, from the URL's search params. Anything missing or unknown falls
// back to the default.
export function readQueueState(params, isStaff) {
  const tabs = tabsFor(isStaff);
  const tab = tabs.find((t) => t.value === params.get('tab')) ?? tabs[0];
  const fallback = defaultSort(isStaff);
  const sort = SORTS[params.get('sort')] ? params.get('sort') : fallback.sort;
  const order = ['asc', 'desc'].includes(params.get('order'))
    ? params.get('order')
    : sort === fallback.sort
      ? fallback.order
      : SORTS[sort].defaultOrder;
  const page = Number.parseInt(params.get('page') ?? '', 10);

  return {
    tab,
    statuses: listParam(params, 'status', tab.statuses),
    priorities: listParam(params, 'priority', Object.keys(PRIORITIES)),
    search: params.get('q') ?? '',
    sort,
    order,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

// The query for GET /api/tickets. An empty status filter means "all of the tab's statuses".
export function toApiFilters(state) {
  const statuses = state.statuses.length > 0 ? state.statuses : state.tab.statuses;
  return {
    ...state.tab.filters,
    // Every status means no filter at all, which keeps the URL the API sees short.
    status: statuses.length === ALL_STATUSES.length ? undefined : statuses,
    priority: state.priorities,
    search: state.search.trim(),
    sort: state.sort,
    order: state.order,
    page: state.page,
    pageSize: PAGE_SIZE,
  };
}

// Whether the user narrowed the tab with the filter bar (so "Clear filters" has a job to do).
export function hasFilters(state) {
  return state.statuses.length > 0 || state.priorities.length > 0 || state.search.trim() !== '';
}

// Returns new search params with `changes` applied. Empty values are removed, and any change
// except paging goes back to page 1, because the old page number may no longer exist.
export function updateParams(params, changes) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    const text = Array.isArray(value) ? value.join(',') : (value ?? '');
    if (text === '') next.delete(key);
    else next.set(key, String(text));
  }
  if (!('page' in changes)) next.delete('page');
  return next;
}

// "Showing 26 to 50 of 132".
export function showingText({ page, pageSize, total }) {
  if (total === 0) return 'No tickets';
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `Showing ${first} to ${last} of ${total}`;
}
