// Friendly message for an empty list or a missing record, with an optional icon and action.
import { Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconInbox } from '@tabler/icons-react';

export function EmptyState({ icon: Icon = IconInbox, title, description, action }) {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Stack align="center" gap="xs" py="xl" ta="center">
      <ThemeIcon size={48} radius="xl" variant="light" color="gray">
        <Icon size={26} aria-hidden />
      </ThemeIcon>
      <Title order={4}>{title}</Title>
      {description && (
        <Text c="dimmed" size="sm" maw={420}>
          {description}
        </Text>
      )}
      {action}
    </Stack>
  );
}
