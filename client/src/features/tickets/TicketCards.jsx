// The ticket queue as a list of cards, for narrow screens where the table's columns don't fit.
import { Card, Group, Skeleton, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { PriorityBadge } from '../../components/PriorityBadge.jsx';
import { RelativeTime } from '../../components/RelativeTime.jsx';
import { SlaBadge } from '../../components/SlaBadge.jsx';
import { overallClock } from '../../components/sla.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import classes from './TicketCards.module.css';

const SKELETON_CARDS = 4;

export function TicketCards({ tickets, isLoading }) {
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
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <Skeleton key={i} height={96} radius="md" />
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {tickets.map((ticket) => (
        // The whole card is one link, so it works with the keyboard and opens in a new tab.
        <Card
          key={ticket.id}
          component={Link}
          to={`/tickets/${ticket.id}`}
          withBorder
          padding="sm"
          className={classes.ticketCard}
        >
          <Group justify="space-between" wrap="nowrap" mb={4}>
            <Text fw={600} size="sm" c="indigo">
              {ticket.display_id}
            </Text>
            <RelativeTime date={ticket.updated_at} size="xs" c="dimmed" />
          </Group>
          <Text size="sm" fw={500} lineClamp={2} mb="xs">
            {ticket.title}
          </Text>
          <Group gap={6}>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <SlaBadge {...overallClock(ticket)} />
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            {ticket.assignee_name ?? 'Unassigned'}
            {ticket.category_name ? ` · ${ticket.category_name}` : ''}
          </Text>
        </Card>
      ))}
    </Stack>
  );
}
