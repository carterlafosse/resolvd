// The ticket's conversation and history in time order: comments as cards (internal notes in
// yellow, marked "Internal") and changes as one-line entries.
import { Badge, Group, Paper, Skeleton, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState.jsx';
import { RelativeTime } from '../../components/RelativeTime.jsx';
import classes from './ActivityFeed.module.css';
import { describeEvent } from './activityText.js';

export function ActivityFeed({ items, isLoading }) {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  if (isLoading) {
    return (
      <Stack gap="sm">
        <Skeleton height={20} width="60%" />
        <Skeleton height={80} />
        <Skeleton height={20} width="40%" />
      </Stack>
    );
  }

  if (items.length === 0) {
    return <EmptyState icon={IconHistory} title="No activity yet" />;
  }

  const renderComment = (item) => (
    <Paper
      key={`comment-${item.id}`}
      withBorder
      p="md"
      className={item.is_internal ? classes.internalNote : undefined}
    >
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Group gap="xs">
          <Text fw={600} size="sm">
            {item.actor_name}
          </Text>
          {item.is_internal && (
            <Badge color="yellow" variant="filled" size="xs">
              Internal
            </Badge>
          )}
        </Group>
        <RelativeTime date={item.created_at} size="xs" c="dimmed" />
      </Group>
      <Text size="sm" className={classes.commentBody}>
        {item.body}
      </Text>
    </Paper>
  );

  const renderEvent = (item) => (
    <Group key={`event-${item.id}`} gap="xs" wrap="nowrap" className={classes.event}>
      <ThemeIcon size="sm" variant="light" color="gray" radius="xl">
        <IconHistory size={12} aria-hidden />
      </ThemeIcon>
      <Text size="sm" c="dimmed">
        {describeEvent(item)} · <RelativeTime date={item.created_at} size="sm" c="dimmed" />
      </Text>
    </Group>
  );

  return (
    <Stack gap="sm">
      {items.map((item) => (item.type === 'comment' ? renderComment(item) : renderEvent(item)))}
    </Stack>
  );
}
