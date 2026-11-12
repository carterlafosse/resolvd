// Tests for the admin pages: user controls (and your own row locked), category rename, SLA times.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App.jsx';
import { mockSession, renderWithProviders } from '../../test/renderWithProviders.jsx';

const adminSession = {
  user: { id: 1, name: 'Sam Admin', email: 'sam@acme.test', role: 'admin' },
  organization: { id: 1, name: 'Acme Corp', slug: 'acme-corp' },
};

const users = [
  { id: 1, name: 'Sam Admin', email: 'sam@acme.test', role: 'admin', is_active: true },
  {
    id: 2,
    name: 'Tess Tech',
    email: 'tess@acme.test',
    role: 'technician',
    is_active: true,
    last_login_at: '2026-11-11T09:00:00.000Z',
  },
];

const policies = [
  { priority: 'critical', response_minutes: 60, resolution_minutes: 240, updated_at: 'a' },
  { priority: 'low', response_minutes: 1440, resolution_minutes: 10080, updated_at: 'b' },
];

// Answers the admin endpoints and records every request that changes something.
function mockApi() {
  const writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method ?? 'GET';
      if (method !== 'GET') {
        writes.push({ path, method, body: JSON.parse(options.body) });
        return Response.json({});
      }
      if (path.startsWith('/api/users')) return Response.json({ data: users });
      if (path === '/api/categories') return Response.json({ data: [{ id: 3, name: 'Hardware' }] });
      if (path === '/api/sla-policies') return Response.json({ data: policies });
      return mockSession(adminSession)(url);
    }),
  );
  return writes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminUsersPage', () => {
  it("deactivates another user but locks the admin's own row", async () => {
    const writes = mockApi();
    renderWithProviders(<App />, { route: '/admin/users' });

    const ownSwitch = await screen.findByLabelText('Sam Admin is active');
    expect(ownSwitch.disabled).toBe(true);
    expect(screen.getByText('Never')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Tess Tech is active'));
    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/users/2',
        method: 'PATCH',
        body: { isActive: false },
      }),
    );
  });
});

describe('AdminCategoriesPage', () => {
  it('renames a category inline', async () => {
    const writes = mockApi();
    renderWithProviders(<App />, { route: '/admin/categories' });

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Hardware' }));
    fireEvent.change(screen.getByLabelText('New name for Hardware'), {
      target: { value: 'Hardware & devices' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/categories/3',
        method: 'PATCH',
        body: { name: 'Hardware & devices' },
      }),
    );
  });
});

describe('AdminSlaPage', () => {
  it('shows times in hours or days and saves them as minutes', async () => {
    const writes = mockApi();
    renderWithProviders(<App />, { route: '/admin/sla' });

    const [criticalResponse] = await screen.findAllByLabelText('First response within');
    expect(criticalResponse.value).toBe('1');
    fireEvent.change(criticalResponse, { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/sla-policies/critical',
        method: 'PUT',
        body: { responseMinutes: 120, resolutionMinutes: 240 },
      }),
    );
  });

  it('refuses a response time that is not shorter than the resolution time', async () => {
    const writes = mockApi();
    renderWithProviders(<App />, { route: '/admin/sla' });

    const [criticalResponse] = await screen.findAllByLabelText('First response within');
    fireEvent.change(criticalResponse, { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Must be longer than the response time')).toBeTruthy();
    expect(writes).toHaveLength(0);
  });
});
