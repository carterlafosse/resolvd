// Tests for the route guards: signed-out redirect, admin-only pages and the admin navigation.
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { mockSession, renderWithProviders } from './test/renderWithProviders.jsx';

const organization = { id: 1, name: 'Acme Corp', slug: 'acme-corp' };
const sessionFor = (role) => ({
  user: { id: 1, name: 'Pat Example', email: 'pat@acme.test', role },
  organization,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('route guards', () => {
  it('sends a signed-out visitor to the sign-in page', async () => {
    vi.stubGlobal('fetch', vi.fn(mockSession(null)));
    renderWithProviders(<App />, { route: '/tickets' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows the admin section to admins only', async () => {
    vi.stubGlobal('fetch', vi.fn(mockSession(sessionFor('admin'))));
    renderWithProviders(<App />, { route: '/tickets' });
    expect(await screen.findByRole('link', { name: 'SLA policies' })).toBeTruthy();
    expect(screen.getByText('Acme Corp')).toBeTruthy();
  });

  it('hides the admin section from technicians', async () => {
    vi.stubGlobal('fetch', vi.fn(mockSession(sessionFor('technician'))));
    renderWithProviders(<App />, { route: '/tickets' });
    // The navbar and the queue's header both link to New ticket.
    expect((await screen.findAllByRole('link', { name: 'New ticket' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('shows a no-access message when an end user opens an admin page', async () => {
    vi.stubGlobal('fetch', vi.fn(mockSession(sessionFor('end_user'))));
    renderWithProviders(<App />, { route: '/admin/users' });
    expect(await screen.findByText("You don't have access to this page")).toBeTruthy();
  });

  it('signs in and returns to the page the visitor asked for', async () => {
    const session = sessionFor('technician');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        if (String(url) === '/api/auth/login') {
          const { password } = JSON.parse(options.body);
          return password === 'right-password-1'
            ? Response.json(session)
            : Response.json(
                { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
                { status: 401 },
              );
        }
        return mockSession(null)(url);
      }),
    );
    renderWithProviders(<App />, { route: '/tickets/42' });

    const type = async (label, value) =>
      fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    await type('Email', 'pat@acme.test');
    await type('Password', 'wrong-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeTruthy();

    await type('Password', 'right-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Ticket 42' })).toBeTruthy();
  });

  it('shows the 404 page for an unknown address', async () => {
    vi.stubGlobal('fetch', vi.fn(mockSession(sessionFor('end_user'))));
    renderWithProviders(<App />, { route: '/no-such-page' });
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });
});
