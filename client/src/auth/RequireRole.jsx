// Route guard: shows the page only to the given roles, and a friendly message to everyone else.
// This only hides screens a role can't use. The API checks the role on every request, so
// skipping this guard would only show a page whose requests all fail with 403.
import { Button, Center, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth.js';

export function RequireRole({ roles }) {
  // ----- State -----
  // none

  // ----- Data -----
  const { user } = useAuth();

  // ----- Handlers -----
  // none

  // ----- Render -----
  if (roles.includes(user?.role)) return <Outlet />;

  return (
    <Center py="xl">
      <Paper withBorder p="xl" maw={440}>
        <Stack align="center" gap="sm" ta="center">
          <ThemeIcon size={48} radius="xl" variant="light" color="gray">
            <IconLock size={26} />
          </ThemeIcon>
          <Title order={3}>You don't have access to this page</Title>
          <Text c="dimmed">
            This area is for administrators. If you need access, ask an admin in your organization.
          </Text>
          <Button component={Link} to="/tickets" variant="light">
            Back to tickets
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
