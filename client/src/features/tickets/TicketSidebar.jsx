// Right-hand column of the ticket page: status, priority and assignee controls, both SLA clocks,
// and the ticket's details. Every option shown comes from what the API said this viewer may do.
import { Button, Divider, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { IconCheck, IconRotateClockwise, IconUserCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { assignTicket, assignToMe, changePriority, changeStatus } from '../../api/tickets.js';
import { listUsers, userKeys } from '../../api/users.js';
import { RelativeTime } from '../../components/RelativeTime.jsx';
import { SlaBadge } from '../../components/SlaBadge.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { PRIORITIES, STATUSES } from '../../constants.js';
import { fullDate } from '../../dates.js';
import { useTicketMutation } from './useTicketMutation.js';

const PRIORITY_OPTIONS = Object.entries(PRIORITIES).map(([value, { label }]) => ({
  value,
  label,
}));

// Only active staff can be assigned (the API refuses anyone else with 400).
const ASSIGNABLE_FILTERS = { active: true };

export function TicketSidebar({ ticket, isStaff, currentUserId }) {
  // ----- State -----
  // none

  // ----- Data -----
  const staff = useQuery({
    queryKey: userKeys.list(ASSIGNABLE_FILTERS),
    queryFn: ({ signal }) => listUsers(ASSIGNABLE_FILTERS, { signal }),
    enabled: isStaff,
  });
  const status = useTicketMutation((to) => changeStatus(ticket.id, to));
  const priority = useTicketMutation((value) => changePriority(ticket.id, value));
  const assign = useTicketMutation((assigneeId) => assignTicket(ticket.id, assigneeId));
  const takeIt = useTicketMutation(() => assignToMe(ticket.id));

  const isClosed = ticket.status === 'closed';
  // The current status first, then only the moves the API allows this viewer.
  const statusOptions = [ticket.status, ...ticket.allowedTransitions].map((value) => ({
    value,
    label: STATUSES[value].label,
  }));
  const assigneeOptions = (staff.data?.data ?? [])
    .filter((user) => user.role !== 'end_user')
    .map((user) => ({ value: String(user.id), label: user.name }));
  // An assignee who has since been deactivated isn't in the list, but should still show.
  if (ticket.assignee_id && !assigneeOptions.some((o) => o.value === String(ticket.assignee_id))) {
    assigneeOptions.unshift({ value: String(ticket.assignee_id), label: ticket.assignee_name });
  }
  const canConfirm = ticket.allowedTransitions.includes('closed');
  const canReopen = ticket.allowedTransitions.includes('open');

  // ----- Handlers -----
  const handleStatusChange = (value) => {
    if (value && value !== ticket.status) status.mutate(value);
  };
  const handlePriorityChange = (value) => {
    if (value && value !== ticket.priority) priority.mutate(value);
  };
  const handleAssigneeChange = (value) => assign.mutate(value ? Number(value) : null);
  const handleAssignToMe = () => takeIt.mutate();
  const handleConfirmFix = () => status.mutate('closed');
  const handleReopen = () => status.mutate('open');

  // ----- Render -----
  const staffControls = (
    <Stack gap="sm">
      <Select
        label="Status"
        data={statusOptions}
        value={ticket.status}
        onChange={handleStatusChange}
        allowDeselect={false}
        disabled={ticket.allowedTransitions.length === 0 || status.isPending}
      />
      <Select
        label="Priority"
        data={PRIORITY_OPTIONS}
        value={ticket.priority}
        onChange={handlePriorityChange}
        allowDeselect={false}
        disabled={isClosed || priority.isPending}
      />
      <Select
        label="Assignee"
        placeholder="Unassigned"
        data={assigneeOptions}
        value={ticket.assignee_id ? String(ticket.assignee_id) : null}
        onChange={handleAssigneeChange}
        clearable
        searchable
        disabled={isClosed || assign.isPending}
      />
      {!isClosed && ticket.assignee_id !== currentUserId && (
        <Button
          variant="light"
          leftSection={<IconUserCheck size={16} />}
          onClick={handleAssignToMe}
          loading={takeIt.isPending}
        >
          Assign to me
        </Button>
      )}
    </Stack>
  );

  // End users answer a resolution instead of picking a status.
  const requesterControls = (
    <Stack gap="sm">
      <Group gap="xs">
        <Text size="sm" fw={500}>
          Status
        </Text>
        <StatusBadge status={ticket.status} />
      </Group>
      {canConfirm && (
        <>
          <Text size="sm">Support marked this as resolved. Is the problem fixed?</Text>
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={handleConfirmFix}
            loading={status.isPending && status.variables === 'closed'}
            disabled={status.isPending}
          >
            Yes, it's fixed
          </Button>
          {canReopen ? (
            <Button
              variant="default"
              leftSection={<IconRotateClockwise size={16} />}
              onClick={handleReopen}
              loading={status.isPending && status.variables === 'open'}
              disabled={status.isPending}
            >
              Still having this issue
            </Button>
          ) : (
            <Text size="xs" c="dimmed">
              It's been more than 7 days since this was resolved. If the problem is back, please
              submit a new ticket.
            </Text>
          )}
        </>
      )}
    </Stack>
  );

  const renderClock = (name, state, dueAt) => (
    <Stack gap={2}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={500}>
          {name}
        </Text>
        <SlaBadge state={state} dueAt={dueAt} name={name} />
      </Group>
      {dueAt && (
        <Text size="xs" c="dimmed">
          Due {fullDate(dueAt)}
        </Text>
      )}
    </Stack>
  );

  const renderDetail = (label, value) => (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right" span>
        {value}
      </Text>
    </Group>
  );

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        {isStaff ? staffControls : requesterControls}
      </Paper>

      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          SLA
        </Title>
        <Stack gap="sm">
          {renderClock('Response', ticket.sla?.response, ticket.response_due_at)}
          {ticket.first_response_at && (
            <Text size="xs" c="dimmed">
              First response <RelativeTime date={ticket.first_response_at} size="xs" />
            </Text>
          )}
          <Divider />
          {renderClock('Resolution', ticket.sla?.resolution, ticket.resolution_due_at)}
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Details
        </Title>
        <Stack gap={6}>
          {renderDetail('Requester', ticket.requester_name)}
          {!isStaff && renderDetail('Assignee', ticket.assignee_name ?? 'Not assigned yet')}
          {renderDetail('Category', ticket.category_name ?? 'None')}
          {renderDetail('Created', <RelativeTime date={ticket.created_at} />)}
          {renderDetail('Updated', <RelativeTime date={ticket.updated_at} />)}
          {ticket.resolved_at &&
            renderDetail('Resolved', <RelativeTime date={ticket.resolved_at} />)}
          {ticket.closed_at && renderDetail('Closed', <RelativeTime date={ticket.closed_at} />)}
        </Stack>
      </Paper>
    </Stack>
  );
}
