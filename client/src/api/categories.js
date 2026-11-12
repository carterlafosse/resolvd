// Category endpoints: list for everyone, add and rename for admins.
import { api } from './client.js';

export const listCategories = ({ signal } = {}) => api('/categories', { signal });
export const createCategory = (name) => api('/categories', { method: 'POST', body: { name } });
export const renameCategory = (id, name) =>
  api(`/categories/${id}`, { method: 'PATCH', body: { name } });
