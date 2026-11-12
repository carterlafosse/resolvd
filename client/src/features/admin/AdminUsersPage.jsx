// Admin: the organization's users, with role and active controls per row and an Add user modal.
import {
  Alert,
  Badge,
  Button,
  Paper,
  Select,
  Skeleton,
  Switch,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconUserPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listUsers, updateUser, userKeys } from '../../api/users.js';
import { useAuth } from '../../auth/useAuth.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { RelativeTime } from '../../components/RelativeTime.jsx';
import { ROLES } from '../../constants.js';
import { AddUserModal } from './AddUserModal.jsx';
import { usePageTitle } from '../../usePageTitle.js';

const ROLE_OPTIONS = Object.entries(ROLES).map(([value, { label }]) => ({ value, label }));
const ALL_USERS = {};
const SKELETON_ROWS = 5;
const SELF_HINT = "You can't change your own role or deactivate yourself.";

export function AdminUsersPage() {
  // ----- State -----
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);

  // ----- Data -----
  usePageTitle('Users');
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const users = useQuery({
    queryKey: userKeys.list(ALL_USERS),
    queryFn: ({ signal }) => listUsers(ALL_USERS, { signal }),
  });
  // Errors such as "the last admin" come back from the API and show as a notification. The
  // controls show the saved value, so a refused change simply doesn't stick.
  const update = useMutation({
    mutationFn: ({ id, changes }) => updateUser(id, changes),
    onSettled: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });

  // ----- Handlers -----
  const handleRoleChange = (id) => (role) => {
    if (role) update.mutate({ id, changes: { role } });
  };
  const handleActiveChange = (id) => (event) =>
    update.mutate({ id, changes: { isActive: event.currentTarget.checked } });

  // ----- Render -----
  const isBusy = (id) => update.isPending && update.variables?.id === id;

  const skeletonRows = Array.from({ length: SKELETON_ROWS }, (_, row) => (
    <Table.Tr key={row}>
      {Array.from({ length: 5 }, (_, cell) => (
        <Table.Td key={cell}>
          <Skeleton height={14} />
        </Table.Td>
      ))}
    </Table.Tr>
  ));

  const rows = (users.data?.data ?? []).map((user) => {
    const isSelf = user.id === me?.id;
    const roleSelect = (
      <Select
        aria-label={`Role for ${user.name}`}
        data={ROLE_OPTIONS}
        value={user.role}
        onChange={handleRoleChange(user.id)}
        allowDeselect={false}
        disabled={isSelf || isBusy(user.id)}
        size="xs"
        w={140}
      />
    );
    const activeSwitch = (
      <Switch
        aria-label={`${user.name} is active`}
        checked={user.is_active}
        onChange={handleActiveChange(user.id)}
        disabled={isSelf || isBusy(user.id)}
      />
    );
    return (
      <Table.Tr key={user.id}>
        <Table.Td>
          <Text size="sm" fw={500}>
            {user.name}{' '}
            {isSelf && (
              <Badge size="xs" variant="light">
                You
              </Badge>
            )}
          </Text>
          {user.department && (
            <Text size="xs" c="dimmed">
              {user.department}
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          <Text size="sm">{user.email}</Text>
        </Table.Td>
        <Table.Td>
          {isSelf ? <Tooltip label={SELF_HINT}>{roleSelect}</Tooltip> : roleSelect}
        </Table.Td>
        <Table.Td>
          {isSelf ? <Tooltip label={SELF_HINT}>{activeSwitch}</Tooltip> : activeSwitch}
        </Table.Td>
        <Table.Td>
          {user.last_login_at ? (
            <RelativeTime date={user.last_login_at} c="dimmed" />
          ) : (
            <Text size="sm" c="dimmed">
              Never
            </Text>
          )}
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone in your organization and what they can do."
        actions={
          <Button leftSection={<IconUserPlus size={16} />} onClick={openAdd}>
            Add user
          </Button>
        }
      />

      {users.isError ? (
        <Alert color="red" variant="light" icon={<IconAlertCircle />} title="Couldn't load users">
          {users.error.message}
        </Alert>
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={720}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Active</Table.Th>
                  <Table.Th>Last login</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{users.isPending ? skeletonRows : rows}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      <AddUserModal opened={addOpened} onClose={closeAdd} />
    </>
  );
}
