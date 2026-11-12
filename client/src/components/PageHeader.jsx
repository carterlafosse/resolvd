// Page title with an optional description underneath and action buttons on the right.
import { Group, Stack, Text, Title } from '@mantine/core';

export function PageHeader({ title, description, actions }) {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap">
      <Stack gap={4}>
        <Title order={2}>{title}</Title>
        {description && <Text c="dimmed">{description}</Text>}
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}
