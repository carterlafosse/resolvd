// Shared frame for the sign-in and sign-up pages: brand, heading, and a centred card.
import { Container, Paper, Stack, Text, Title } from '@mantine/core';

export function AuthShell({ title, subtitle, children, footer }) {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Container size={440} py={48}>
      <Stack gap="lg">
        <Stack gap={4} ta="center">
          <Text fw={800} fz={28} c="indigo">
            Resolvd
          </Text>
          <Title order={2}>{title}</Title>
          {subtitle && <Text c="dimmed">{subtitle}</Text>}
        </Stack>
        <Paper withBorder shadow="sm" p="lg">
          {children}
        </Paper>
        {footer}
      </Stack>
    </Container>
  );
}
