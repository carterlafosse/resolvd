// Ticket queue: tabs, filters, sorting and paging, all kept in the URL so a view can be shared,
// bookmarked, and restored with the back button.
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  MultiSelect,
  Pagination,
  Paper,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { IconAlertCircle, IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { listTickets, ticketKeys } from '../../api/tickets.js';
import { useAuth } from '../../auth/useAuth.js';
import { EmptyState } from '../../components/EmptyState.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { PRIORITIES, STATUSES } from '../../constants.js';
import {
  hasFilters,
  readQueueState,
  SORTS,
  showingText,
  tabsFor,
  toApiFilters,
  updateParams,
} from './queueFilters.js';
import { TicketCards } from './TicketCards.jsx';
import classes from './TicketQueuePage.module.css';
import { TicketTable } from './TicketTable.jsx';

const SEARCH_DEBOUNCE_MS = 300;

const PRIORITY_OPTIONS = Object.entries(PRIORITIES).map(([value, { label }]) => ({
  value,
  label,
}));

export function TicketQueuePage() {
  // ----- State -----
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // The search box updates as you type; the URL (and so the request) follows 300 ms later.
  const urlSearch = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [syncedSearch, setSyncedSearch] = useState(urlSearch);
  // When the URL's search changes from elsewhere (back button, Clear filters), the box follows.
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch);
    setSearchInput(urlSearch);
  }

  // ----- Data -----
  const { isStaff } = useAuth();
  const queue = readQueueState(searchParams, isStaff);
  const filters = toApiFilters(queue);
  const tickets = useQuery({
    queryKey: ticketKeys.list(filters),
    queryFn: ({ signal }) => listTickets(filters, { signal }),
    // Keep showing the current page while the next one loads, instead of flashing skeletons.
    placeholderData: keepPreviousData,
  });
  const rows = tickets.data?.data ?? [];
  const pagination = tickets.data?.pagination;
  const statusOptions = queue.tab.statuses.map((value) => ({
    value,
    label: STATUSES[value].label,
  }));

  // ----- Handlers -----
  // Functional update, so a late debounced search never undoes a newer change.
  const changeParams = (changes) => setSearchParams((current) => updateParams(current, changes));
  const pushSearch = useDebouncedCallback(
    (value) => changeParams({ q: value }),
    SEARCH_DEBOUNCE_MS,
  );

  // A new tab has different statuses, so the status filter starts again.
  const handleTabChange = (tab) => changeParams({ tab, status: '' });
  const handleStatusChange = (statuses) => changeParams({ status: statuses });
  const handlePriorityChange = (priorities) => changeParams({ priority: priorities });
  const handleSearchChange = (event) => {
    setSearchInput(event.currentTarget.value);
    pushSearch(event.currentTarget.value);
  };
  const handleClearFilters = () => {
    pushSearch.cancel();
    setSearchInput('');
    changeParams({ status: '', priority: '', q: '' });
  };
  // Clicking the sorted column flips the order; another column starts with its usual order.
  const handleSort = (sort) => {
    const order =
      sort === queue.sort ? (queue.order === 'asc' ? 'desc' : 'asc') : SORTS[sort].defaultOrder;
    changeParams({ sort, order });
  };
  const handlePageChange = (page) => changeParams({ page });
  const handleOpenTicket = (id) => navigate(`/tickets/${id}`);

  // ----- Render -----
  const filtered = hasFilters(queue);
  const isEmpty = tickets.isSuccess && rows.length === 0;

  return (
    <>
      <PageHeader
        title="Tickets"
        description={isStaff ? 'Work the queue by deadline.' : 'Your requests to IT support.'}
        actions={
          <Button component={Link} to="/tickets/new" leftSection={<IconPlus size={16} />}>
            New ticket
          </Button>
        }
      />

      <Tabs value={queue.tab.value} onChange={handleTabChange} mb="md">
        <Tabs.List>
          {tabsFor(isStaff).map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group className={classes.filterBar} gap="sm" mb="md" align="flex-end">
        <TextInput
          className={classes.searchInput}
          label="Search"
          placeholder="Title or RES-1042"
          leftSection={<IconSearch size={16} />}
          value={searchInput}
          onChange={handleSearchChange}
        />
        {statusOptions.length > 1 && (
          <MultiSelect
            className={classes.filterSelect}
            label="Status"
            placeholder={queue.statuses.length ? undefined : 'Any'}
            data={statusOptions}
            value={queue.statuses}
            onChange={handleStatusChange}
            clearable
          />
        )}
        <MultiSelect
          className={classes.filterSelect}
          label="Priority"
          placeholder={queue.priorities.length ? undefined : 'Any'}
          data={PRIORITY_OPTIONS}
          value={queue.priorities}
          onChange={handlePriorityChange}
          clearable
        />
        {filtered && (
          <Button
            variant="subtle"
            leftSection={<IconFilterOff size={16} />}
            onClick={handleClearFilters}
          >
            Clear filters
          </Button>
        )}
      </Group>

      {tickets.isError && !tickets.data ? (
        <Alert color="red" variant="light" icon={<IconAlertCircle />} title="Couldn't load tickets">
          {tickets.error.message}
        </Alert>
      ) : isEmpty ? (
        <Paper withBorder>
          <EmptyState
            title={filtered ? 'No tickets match these filters' : 'Nothing here right now'}
            description={
              filtered
                ? 'Try another search or clear the filters.'
                : 'Tickets in this view will appear here.'
            }
            action={
              filtered ? (
                <Button variant="light" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        </Paper>
      ) : (
        <>
          <Paper withBorder visibleFrom="md">
            <TicketTable
              tickets={rows}
              isLoading={tickets.isPending}
              sort={queue.sort}
              order={queue.order}
              onSort={handleSort}
              onOpen={handleOpenTicket}
            />
          </Paper>
          <Box hiddenFrom="md">
            <TicketCards tickets={rows} isLoading={tickets.isPending} />
          </Box>
        </>
      )}

      {pagination && pagination.total > 0 && (
        <Group justify="space-between" mt="md" wrap="wrap">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {showingText(pagination)}
            </Text>
            {tickets.isFetching && <Loader size="xs" aria-label="Updating" />}
          </Group>
          {pagination.totalPages > 1 && (
            <Pagination
              total={pagination.totalPages}
              value={pagination.page}
              onChange={handlePageChange}
              size="sm"
            />
          )}
        </Group>
      )}
    </>
  );
}
