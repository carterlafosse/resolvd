// Tests for the new ticket form: priority choices by role, validation, and the request it sends.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App.jsx';
import { mockSession, renderWithProviders } from '../../test/renderWithProviders.jsx';

const sessionFor = (role) => ({
  user: { id: 7, name: 'Pat Example', email: 'pat@acme.test', role },
  organization: { id: 1, name: 'Acme Corp', slug: 'acme-corp' },
});

function mockApi(role) {
  const posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const path = String(url);
      if (path === '/api/categories') {
        return Response.json({ data: [{ id: 3, name: 'Hardware' }] });
      }
      if (path === '/api/tickets' && options.method === 'POST') {
        posts.push(JSON.parse(options.body));
        return Response.json({ id: 42, display_id: 'RES-1042' }, { status: 201 });
      }
      return mockSession(sessionFor(role))(url);
    }),
  );
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewTicketPage', () => {
  it('offers critical priority to staff only', async () => {
    mockApi('end_user');
    const { unmount } = renderWithProviders(<App />, { route: '/tickets/new' });
    expect(await screen.findByText('High')).toBeTruthy();
    expect(screen.queryByText('Critical')).toBeNull();
    unmount();

    mockApi('technician');
    renderWithProviders(<App />, { route: '/tickets/new' });
    expect(await screen.findByText('Critical')).toBeTruthy();
  });

  it('checks the API limits before sending anything', async () => {
    const posts = mockApi('end_user');
    renderWithProviders(<App />, { route: '/tickets/new' });

    fireEvent.change(await screen.findByLabelText(/Title/), { target: { value: 'VPN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));

    expect(await screen.findByText('Use at least 5 characters')).toBeTruthy();
    expect(screen.getByText(/at least 10 characters/)).toBeTruthy();
    expect(posts).toHaveLength(0);
  });

  it('sends the ticket with medium priority by default', async () => {
    const posts = mockApi('end_user');
    renderWithProviders(<App />, { route: '/tickets/new' });

    fireEvent.change(await screen.findByLabelText(/Title/), {
      target: { value: '  VPN drops every hour  ' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'The VPN disconnects about once an hour.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      title: '  VPN drops every hour  ',
      description: 'The VPN disconnects about once an hour.',
      priority: 'medium',
      categoryId: null,
    });
  });
});
