// Ticket endpoints: queue, detail, edits, workflow, comments and history.
import { api } from './client.js';

// TanStack Query keys. Everything about tickets starts with 'tickets', so after any change
// invalidating ['tickets'] refreshes the queue, the open ticket and its activity together.
export const ticketKeys = {
  all: ['tickets'],
  list: (filters) => ['tickets', 'list', filters],
  detail: (id) => ['tickets', 'detail', String(id)],
  activity: (id) => ['tickets', 'detail', String(id), 'activity'],
};

// filters: status, priority, assignee, categoryId, search, sla, sort, order, page, pageSize.
export const listTickets = (filters, { signal } = {}) =>
  api('/tickets', { query: filters, signal });
export const getTicket = (id, { signal } = {}) => api(`/tickets/${id}`, { signal });
export const createTicket = (values) => api('/tickets', { method: 'POST', body: values });
// Include expectedUpdatedAt in edits so a stale copy gets a 409 instead of overwriting.
export const updateTicket = (id, values) =>
  api(`/tickets/${id}`, { method: 'PATCH', body: values });

export const changeStatus = (id, status) =>
  api(`/tickets/${id}/status`, { method: 'PATCH', body: { status } });
export const assignTicket = (id, assigneeId) =>
  api(`/tickets/${id}/assignment`, { method: 'PATCH', body: { assigneeId } });
export const assignToMe = (id) => api(`/tickets/${id}/assign-to-me`, { method: 'POST' });
export const changePriority = (id, priority) =>
  api(`/tickets/${id}/priority`, { method: 'PATCH', body: { priority } });

export const listComments = (id, { signal } = {}) => api(`/tickets/${id}/comments`, { signal });
export const addComment = (id, { body, isInternal = false }) =>
  api(`/tickets/${id}/comments`, { method: 'POST', body: { body, isInternal } });
export const listEvents = (id, { signal } = {}) => api(`/tickets/${id}/events`, { signal });
export const getActivity = (id, { signal } = {}) => api(`/tickets/${id}/activity`, { signal });
