// Test helper: renders UI inside the same providers as main.jsx, at a chosen address.
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { theme } from '../theme.js';

export function renderWithProviders(ui, { route = '/' } = {}) {
  // A fresh client per test so no cached session leaks between tests; no retries so a
  // failing request fails straight away.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// A fetch stand-in answering /api/auth/me with the given session (or 401 when null).
export function mockSession(session) {
  return async (url) => {
    if (String(url).startsWith('/api/auth/me')) {
      return session
        ? Response.json(session)
        : Response.json(
            { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
            { status: 401 },
          );
    }
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Not mocked' } }, { status: 404 });
  };
}
