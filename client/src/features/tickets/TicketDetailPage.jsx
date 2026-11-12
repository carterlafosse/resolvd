// One ticket: header and activity feed with the reply box on the left, controls and details on
// the right (stacked on small screens).
import { Alert, Button, Grid, Paper, Skeleton, Stack, Title } from '@mantine/core';
import { IconAlertCircle, IconTicketOff } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getActivity, getTicket, ticketKeys } from '../../api/tickets.js';
import { useAuth } from '../../auth/useAuth.js';
import { EmptyState } from '../../components/EmptyState.jsx';
import { ActivityFeed } from './ActivityFeed.jsx';
import { CommentBox } from './CommentBox.jsx';
import { TicketHeader } from './TicketHeader.jsx';
import { TicketSidebar } from './TicketSidebar.jsx';
import { usePageTitle } from '../../usePageTitle.js';

// 404 is "doesn't exist or you can't see it" (the API doesn't say which). 400 means the id in
// the address isn't a valid ticket id, which to the user is the same thing.
const isMissing = (error) => error?.status === 404 || error?.status === 400;

export function TicketDetailPage() {
  // ----- State -----
  const { id } = useParams();

  // ----- Data -----
  const queryClient = useQueryClient();
  const { user, isStaff } = useAuth();
  const ticket = useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: ({ signal }) => getTicket(id, { signal }),
  });
  // Waits for the ticket, so a missing ticket shows one "not found" instead of two errors.
  const activity = useQuery({
    queryKey: ticketKeys.activity(id),
    queryFn: ({ signal }) => getActivity(id, { signal }),
    enabled: ticket.isSuccess,
  });
  // The tab shows the ticket number ("RES-1042 · Resolvd") once it has loaded.
  usePageTitle(
    ticket.data?.display_id ?? (isMissing(ticket.error) ? 'Ticket not found' : 'Ticket'),
  );

  // ----- Handlers -----
  const handleReload = () => queryClient.invalidateQueries({ queryKey: ticketKeys.detail(id) });

  // ----- Render -----
  if (ticket.isPending) {
    return (
      <Stack gap="md">
        <Skeleton height={140} />
        <Skeleton height={240} />
      </Stack>
    );
  }

  if (isMissing(ticket.error)) {
    return (
      <Paper withBorder>
        <EmptyState
          icon={IconTicketOff}
          title="Ticket not found"
          description="It doesn't exist, or you don't have access to it."
          action={
            <Button component={Link} to="/tickets" variant="light">
              Back to tickets
            </Button>
          }
        />
      </Paper>
    );
  }

  if (ticket.isError) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle />} title="Couldn't load ticket">
        {ticket.error.message}
      </Alert>
    );
  }

  const data = ticket.data;
  return (
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, md: 8 }}>
        <Stack gap="md">
          <TicketHeader ticket={data} onReload={handleReload} />
          <Title order={4}>Activity</Title>
          {activity.isError ? (
            <Alert color="red" variant="light" icon={<IconAlertCircle />}>
              {activity.error.message}
            </Alert>
          ) : (
            <ActivityFeed items={activity.data?.data ?? []} isLoading={activity.isPending} />
          )}
          <CommentBox ticketId={data.id} canComment={data.canComment} isStaff={isStaff} />
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <TicketSidebar ticket={data} isStaff={isStaff} currentUserId={user?.id} />
      </Grid.Col>
    </Grid>
  );
}
