// The signed-in session: the ['me'] query, role helpers, and starting or ending a session.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getMe, logout as logoutRequest } from '../api/auth.js';
import { ApiError } from '../api/client.js';
import { STAFF_ROLES } from '../constants.js';

export const ME_QUERY_KEY = ['me'];

// 401 means "nobody is signed in", which is a normal answer here, not an error. The query
// resolves to null so the guards can redirect without the global 401 handler getting involved.
async function fetchSession({ signal }) {
  try {
    return await getMe({ signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

// Removes every cached query except the session itself, so nothing loaded for one user is
// shown to the next one on the same browser tab.
function removeOtherQueries(queryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0] });
}

// After sign-in or sign-up: the response is { user, organization }, the same as /auth/me,
// so it goes straight into the cache without another request.
export function startSession(queryClient, session) {
  removeOtherQueries(queryClient);
  queryClient.setQueryData(ME_QUERY_KEY, session);
}

// After sign-out, or when the API says the session has expired. Setting ['me'] to null makes
// RequireAuth redirect to /login, remembering the page the user was on.
export function endSession(queryClient) {
  removeOtherQueries(queryClient);
  queryClient.setQueryData(ME_QUERY_KEY, null);
}

export function useAuth() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchSession,
    // Role changes and deactivation still reach the browser: the query refetches on window
    // focus once it's this old, and the API checks the database on every request anyway.
    staleTime: 5 * 60 * 1000,
  });

  // Throws if the API can't be reached, so the cookie isn't left behind while the UI says
  // signed out. The global mutation error handler shows the message.
  const logout = useCallback(async () => {
    await logoutRequest();
    endSession(queryClient);
  }, [queryClient]);

  const user = session.data?.user ?? null;
  return {
    user,
    organization: session.data?.organization ?? null,
    isLoading: session.isPending,
    error: session.error,
    refetch: session.refetch,
    isStaff: STAFF_ROLES.includes(user?.role),
    isAdmin: user?.role === 'admin',
    logout,
  };
}
