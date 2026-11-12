// Tests for the ticket queue page: the request it sends, rows, tabs in the URL, and the empty state.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App.jsx';
import { mockSession, renderWithProviders } from '../../test/renderWithProviders.jsx';

const sessionFor = (role) => ({
  user: { id: 7, name: 'Tess Tech', email: 'tess@acme.test', role },
  organization: { id: 1, name: 'Acme Corp', slug: 'acme-corp' },
});

const ticket = {
  id: 42,
  display_id: 'RES-1042',
  title: 'Printer on floor 2 is jammed',
  status: 'open',
  priority: 'critical',
  assignee_name: null,
  category_name: 'Hardware',
  response_due_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  resolution_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
  sla: { response: 'on_track', resolution: 'on_track', overall: 'on_track' },
};

// Answers /api/tickets with `tickets` and records every URL requested.
function mockApi(role, tickets) {
  const urls = [];
  const fetchMock = vi.fn(async (url) => {
    urls.push(String(url));
    if (String(url).startsWith('/api/tickets')) {
      return Response.json({
        data: tickets,
        pagination: { page: 1, pageSize: 25, total: tickets.length, totalPages: 1 },
      });
    }
    return mockSession(sessionFor(role))(url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

const ticketRequests = (urls) => urls.filter((url) => url.startsWith('/api/tickets'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TicketQueuePage', () => {
  it("asks for a technician's own active tickets, soonest deadline first", async () => {
    const urls = mockApi('technician', [ticket]);
    renderWithProviders(<App />, { route: '/tickets' });

    expect((await screen.findAllByText('Printer on floor 2 is jammed')).length).toBeGreaterThan(0);
    const url = new URL(ticketRequests(urls)[0], 'http://localhost');
    expect(url.searchParams.get('assignee')).toBe('me');
    expect(url.searchParams.get('status')).toBe('open,in_progress,on_hold');
    expect(url.searchParams.get('sort')).toBe('resolution_due_at');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(screen.getByText('Showing 1 to 1 of 1')).toBeTruthy();
  });

  it('switches tab and asks for the unassigned tickets', async () => {
    const urls = mockApi('technician', [ticket]);
    renderWithProviders(<App />, { route: '/tickets' });

    fireEvent.click(await screen.findByRole('tab', { name: 'Unassigned' }));

    await waitFor(() => {
      const last = new URL(ticketRequests(urls).at(-1), 'http://localhost');
      expect(last.searchParams.get('assignee')).toBe('unassigned');
    });
  });

  it('reads filters from the URL and offers to clear them when nothing matches', async () => {
    const urls = mockApi('end_user', []);
    renderWithProviders(<App />, { route: '/tickets?tab=closed&q=vpn' });

    expect(await screen.findByText('No tickets match these filters')).toBeTruthy();
    const url = new URL(ticketRequests(urls)[0], 'http://localhost');
    expect(url.searchParams.get('status')).toBe('closed');
    expect(url.searchParams.get('search')).toBe('vpn');
    expect(url.searchParams.get('sort')).toBe('created_at');

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    await waitFor(() => {
      const last = new URL(ticketRequests(urls).at(-1), 'http://localhost');
      expect(last.searchParams.get('search')).toBeNull();
    });
  });
});
