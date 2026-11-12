// Auth endpoints: sign-up, sign-in, sign-out and the current session.
import { api } from './client.js';

// These three return { user, organization }, the same shape the ['me'] query caches.
export const registerOrganization = (values) =>
  api('/auth/register-organization', { method: 'POST', body: values });
export const login = (values) => api('/auth/login', { method: 'POST', body: values });
export const getMe = ({ signal } = {}) => api('/auth/me', { signal });

export const logout = () => api('/auth/logout', { method: 'POST' });
