// Front end entry point: global styles, the query client, the providers, and mounting React.
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api/client.js';
import App from './App.jsx';
import { endSession, ME_QUERY_KEY } from './auth/useAuth.js';
import { theme } from './theme.js';

const isUnauthorized = (error) => error instanceof ApiError && error.status === 401;

// Retry once, and only when a retry could help (network or server trouble). A 4xx answer
// would be the same the second time.
function shouldRetry(failureCount, error) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry, refetchOnWindowFocus: true },
  },
  queryCache: new QueryCache({
    // The session expired or the account was deactivated: drop all cached data and send the
    // user to /login. ['me'] is skipped because it treats 401 as "signed out" by itself.
    onError: (error, query) => {
      if (isUnauthorized(error) && query.queryKey[0] !== ME_QUERY_KEY[0]) {
        endSession(queryClient);
      }
    },
  }),
  mutationCache: new MutationCache({
    // One place shows mutation errors, with the API's own message. Forms that show errors
    // next to their fields set meta.inlineErrors and handle them themselves (this also keeps a
    // wrong password at sign-in from being treated as an expired session).
    onError: (error, _variables, _onMutateResult, mutation) => {
      if (mutation.meta?.inlineErrors) return;
      notifications.show({ color: 'red', title: 'Something went wrong', message: error.message });
      if (isUnauthorized(error)) endSession(queryClient);
    },
  }),
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
);
