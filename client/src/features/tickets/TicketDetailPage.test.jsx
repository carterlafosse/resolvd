// Tests for the ticket page: options from the API's allowed actions, the feed, and edit conflicts.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App.jsx';
import { mockSession, renderWithProviders } from '../../test/renderWithProviders.jsx';

const sessionFor = (role, id = 7) => ({
  user: { id, name: 'Pat Example', email: 'pat@acme.test', role },
  organization: { id: 1, name: 'Acme Corp', slug: 'acme-corp' },
});

const baseTicket = {
  id: 42,
  display_id: 'RES-1042',
  title: 'VPN drops every hour',
  description: 'The VPN disconnects about once an hour.',
  status: 'open',
  priority: 'medium',
  category_id: null,
  category_name: null,
  requester_id: 7,
  requester_name: 'Pat Example',
  assignee_id: null,
  assignee_name: null,
  response_due_at: null,
  resolution_due_at: null,
  first_response_at: null,
  resolved_at: null,
  closed_at: null,
  created_at: '2026-11-10T09:00:00.000Z',
  updated_at: '2026-11-11T09:00:00.000Z',
  sla: { response: 'none', resolution: 'none', overall: 'none' },
  allowedTransitions: [],
  canEdit: true,
  canComment: true,
};

const activity = [
  {
    type: 'event',
    id: 1,
    actor_name: 'Pat Example',
    field: 'created',
    old_value: null,
    new_value: 'open',
    is_internal: false,
    created_at: '2026-11-10T09:00:00.000Z',
  },
  {
    type: 'comment',
    id: 5,
    actor_name: 'Tess Tech',
    body: 'Checking the VPN logs.',
    is_internal: true,
    created_at: '2026-11-10T10:00:00.000Z',
  },
];

// A fake API for one ticket. `respond` can override any request; every request is recorded.
function mockApi({ role = 'end_user', ticket = {}, respond } = {}) {
  const requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const path = String(url);
      const request = {
        path,
        method: options.method ?? 'GET',
        body: options.body && JSON.parse(options.body),
      };
      requests.push(request);
      const custom = respond?.(request);
      if (custom) return custom;
      if (path === '/api/tickets/42') return Response.json({ ...baseTicket, ...ticket });
      if (path === '/api/tickets/42/activity') return Response.json({ data: activity });
      if (path.startsWith('/api/users')) return Response.json({ data: [] });
      if (path === '/api/categories') return Response.json({ data: [] });
      if (request.method !== 'GET') return Response.json({ ...baseTicket, ...ticket });
      return mockSession(sessionFor(role))(url);
    }),
  );
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TicketDetailPage', () => {
  it('shows the ticket and its feed, with internal notes marked', async () => {
    mockApi({ role: 'technician' });
    renderWithProviders(<App />, { route: '/tickets/42' });

    expect(await screen.findByRole('heading', { name: 'VPN drops every hour' })).toBeTruthy();
    expect(await screen.findByText('Checking the VPN logs.')).toBeTruthy();
    expect(screen.getByText('Internal')).toBeTruthy();
    expect(screen.getByText(/Pat Example created the ticket/)).toBeTruthy();
    expect(screen.getByLabelText('Internal note')).toBeTruthy();
  });

  it('lets the requester confirm a resolved ticket, using the allowed moves from the API', async () => {
    const requests = mockApi({
      ticket: { status: 'resolved', allowedTransitions: ['open', 'closed'], canEdit: false },
    });
    renderWithProviders(<App />, { route: '/tickets/42' });

    fireEvent.click(await screen.findByRole('button', { name: "Yes, it's fixed" }));
    expect(screen.getByRole('button', { name: 'Still having this issue' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    await waitFor(() =>
      expect(requests).toContainEqual({
        path: '/api/tickets/42/status',
        method: 'PATCH',
        body: { status: 'closed' },
      }),
    );
  });

  it('offers only confirmation once the reopen window has passed', async () => {
    mockApi({ ticket: { status: 'resolved', allowedTransitions: ['closed'], canEdit: false } });
    renderWithProviders(<App />, { route: '/tickets/42' });

    expect(await screen.findByRole('button', { name: "Yes, it's fixed" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Still having this issue' })).toBeNull();
    expect(screen.getByText(/more than 7 days/)).toBeTruthy();
  });

  it('disables the reply box on a closed ticket', async () => {
    mockApi({ ticket: { status: 'closed', canEdit: false, canComment: false } });
    renderWithProviders(<App />, { route: '/tickets/42' });

    expect(await screen.findByText('This ticket is closed. Please submit a new one.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reply' }).disabled).toBe(true);
  });

  it('sends the version it started editing from, and offers a reload on 409', async () => {
    const requests = mockApi({
      respond: ({ path, method }) =>
        path === '/api/tickets/42' && method === 'PATCH'
          ? Response.json(
              {
                error: {
                  code: 'CONFLICT',
                  message: 'This ticket was changed by someone else. Reload and try again.',
                },
              },
              { status: 409 },
            )
          : null,
    });
    renderWithProviders(<App />, { route: '/tickets/42' });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'VPN drops hourly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('This ticket was changed by someone else')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload ticket' })).toBeTruthy();
    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch.body).toMatchObject({
      title: 'VPN drops hourly',
      expectedUpdatedAt: baseTicket.updated_at,
    });
  });

  it('shows a friendly page for a ticket that does not exist', async () => {
    mockApi({
      respond: ({ path }) =>
        path === '/api/tickets/42'
          ? Response.json(
              { error: { code: 'NOT_FOUND', message: 'Ticket not found' } },
              { status: 404 },
            )
          : null,
    });
    renderWithProviders(<App />, { route: '/tickets/42' });

    expect(await screen.findByText('Ticket not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to tickets' })).toBeTruthy();
  });
});
