// User endpoints: the admin user list and edits, and the signed-in user's own settings.
import { api } from './client.js';

export const userKeys = {
  all: ['users'],
  list: (filters) => ['users', 'list', filters],
};

// filters: role, active. Technicians only get id, name and role (for assignment dropdowns).
export const listUsers = (filters, { signal } = {}) => api('/users', { query: filters, signal });
export const createUser = (values) => api('/users', { method: 'POST', body: values });
export const updateUser = (id, values) => api(`/users/${id}`, { method: 'PATCH', body: values });
export const updateMe = (values) => api('/users/me', { method: 'PATCH', body: values });
