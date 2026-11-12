// SLA policy endpoints: list for staff, update for admins.
import { api } from './client.js';

export const listSlaPolicies = ({ signal } = {}) => api('/sla-policies', { signal });
export const updateSlaPolicy = (priority, { responseMinutes, resolutionMinutes }) =>
  api(`/sla-policies/${priority}`, {
    method: 'PUT',
    body: { responseMinutes, resolutionMinutes },
  });
