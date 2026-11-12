// The ticket queue as a table (wide screens): sortable headers, badges, and rows that open the ticket.
import { Anchor, Skeleton, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { PriorityBadge } from '../../components/PriorityBadge.jsx';
import { RelativeTime } from '../../components/RelativeTime.jsx';
import { SlaBadge } from '../../components/SlaBadge.jsx';
import { overallClock } from '../../components/sla.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import classes from './TicketTable.module.css';

// `sort` is the API sort value for sortable columns; the others can't be sorted by the API.
const COLUMNS = [
  { key: 'id', label: 'ID', sort: 'created_at' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority', sort: 'priority' },
  { key: 'sla', label: 'SLA', sort: 'resolution_due_at' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'category', label: 'Category' },
  { key: 'updated', label: 'Updated', sort: 'updated_at' },
];

const SKELETON_ROWS = 8;

export function TicketTable({ tickets, isLoading, sort, order, onSort, onOpen }) {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  const handleRowClick = (id) => () => onOpen(id);
  // The ID link handles its own click (including ctrl-click for a new tab), so the row's
  // handler mustn't run as well.
  const stopRowClick = (event) => event.stopPropagation();

  // ----- Render -----
  const renderHeader = (column) => {
    if (!column.sort) return <Table.Th key={column.key}>{column.label}</Table.Th>;
    const active = sort === column.sort;
    const SortIcon = !active ? IconSelector : order === 'asc' ? IconChevronUp : IconChevronDown;
    return (
      <Table.Th
        key={column.key}
        aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <UnstyledButton className={classes.sortButton} onClick={() => onSort(column.sort)}>
          {column.label}
          <SortIcon size={14} aria-hidden />
        </UnstyledButton>
      </Table.Th>
    );
  };

  const skeletonRows = Array.from({ length: SKELETON_ROWS }, (_, row) => (
    <Table.Tr key={row}>
      {COLUMNS.map((column) => (
        <Table.Td key={column.key}>
          <Skeleton height={14} />
        </Table.Td>
      ))}
    </Table.Tr>
  ));

  const rows = tickets.map((ticket) => (
    <Table.Tr key={ticket.id} className={classes.row} onClick={handleRowClick(ticket.id)}>
      <Table.Td>
        <Anchor
          component={Link}
          to={`/tickets/${ticket.id}`}
          onClick={stopRowClick}
          fw={600}
          size="sm"
        >
          {ticket.display_id}
        </Anchor>
      </Table.Td>
      <Table.Td className={classes.titleCell}>
        <Text size="sm" lineClamp={1}>
          {ticket.title}
        </Text>
      </Table.Td>
      <Table.Td>
        <StatusBadge status={ticket.status} />
      </Table.Td>
      <Table.Td>
        <PriorityBadge priority={ticket.priority} />
      </Table.Td>
      <Table.Td>
        <SlaBadge {...overallClock(ticket)} />
      </Table.Td>
      <Table.Td>
        <Text size="sm" c={ticket.assignee_name ? undefined : 'dimmed'}>
          {ticket.assignee_name ?? 'Unassigned'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c={ticket.category_name ? undefined : 'dimmed'}>
          {ticket.category_name ?? 'None'}
        </Text>
      </Table.Td>
      <Table.Td>
        <RelativeTime date={ticket.updated_at} c="dimmed" />
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Table.ScrollContainer minWidth={900}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>{COLUMNS.map(renderHeader)}</Table.Tr>
        </Table.Thead>
        <Table.Tbody>{isLoading ? skeletonRows : rows}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
