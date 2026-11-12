// User endpoints: the admin user list and edits, and the signed-in user's own settings.
import { api } from './client.js';

// filters: role, active. Technicians only get id, name and role (for assignment dropdowns).
export const listUsers = (filters, { signal } = {}) => api('/users', { query: filters, signal });
export const createUser = (values) => api('/users', { method: 'POST', body: values });
export const updateUser = (id, values) => api(`/users/${id}`, { method: 'PATCH', body: values });
export const updateMe = (values) => api('/users/me', { method: 'PATCH', body: values });
