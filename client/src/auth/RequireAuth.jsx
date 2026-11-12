// Route guard: shows the page only to a signed-in user, otherwise sends them to /login.
// Like every front-end guard this is for a smooth experience only; the API enforces access.
import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core';
import { IconPlugConnectedX } from '@tabler/icons-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth.js';

export function RequireAuth() {
  // ----- State -----
  const location = useLocation();

  // ----- Data -----
  const { user, isLoading, error, refetch } = useAuth();

  // ----- Handlers -----
  const handleRetry = () => refetch();

  // ----- Render -----
  if (isLoading) {
    return (
      <Center h="100vh">
        <Stack align="center" gap="xs">
          <Loader />
          <Text c="dimmed" size="sm">
            Loading Resolvd…
          </Text>
        </Stack>
      </Center>
    );
  }

  // The session check itself failed (API down or unreachable), which is different from
  // "not signed in". Sending the user to /login would hide the real problem.
  if (error) {
    return (
      <Center h="100vh" p="md">
        <Alert
          color="red"
          title="Can't reach Resolvd"
          icon={<IconPlugConnectedX />}
          maw={420}
          variant="light"
        >
          <Stack gap="sm">
            <Text size="sm">{error.message}</Text>
            <Button variant="light" color="red" onClick={handleRetry}>
              Try again
            </Button>
          </Stack>
        </Alert>
      </Center>
    );
  }

  // Remember where they were going, so signing in takes them back there.
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
