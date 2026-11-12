// 404 page for any address the app doesn't have.
import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Center py="xl">
      <Stack align="center" gap="sm" ta="center" maw={420}>
        <Text fz={64} fw={800} c="dimmed" lh={1}>
          404
        </Text>
        <Title order={2}>Page not found</Title>
        <Text c="dimmed">The page you're looking for doesn't exist or has moved.</Text>
        <Button component={Link} to="/tickets" variant="light">
          Back to tickets
        </Button>
      </Stack>
    </Center>
  );
}
