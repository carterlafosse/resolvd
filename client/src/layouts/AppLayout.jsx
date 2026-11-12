// The signed-in app shell: header (brand, org, theme toggle, user menu), side navigation, page.
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Group,
  Menu,
  NavLink,
  Stack,
  Text,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChevronDown,
  IconClockHour4,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSun,
  IconTags,
  IconTicket,
  IconUsers,
} from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { ROLES } from '../constants.js';
import classes from './AppLayout.module.css';

const MAIN_LINKS = [
  { to: '/tickets', label: 'Tickets', icon: IconTicket },
  { to: '/tickets/new', label: 'New ticket', icon: IconPlus },
];

const ADMIN_LINKS = [
  { to: '/admin/users', label: 'Users', icon: IconUsers },
  { to: '/admin/categories', label: 'Categories', icon: IconTags },
  { to: '/admin/sla', label: 'SLA policies', icon: IconClockHour4 },
];

// "Tickets" stays highlighted on a ticket's detail page, but not on "New ticket", which has
// its own link.
function isLinkActive(to, pathname) {
  if (to === '/tickets') {
    return (
      pathname === '/tickets' || (pathname.startsWith('/tickets/') && pathname !== '/tickets/new')
    );
  }
  return pathname === to;
}

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function AppLayout() {
  // ----- State -----
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // ----- Data -----
  const { user, organization, isAdmin, logout } = useAuth();
  const signOut = useMutation({
    mutationFn: logout,
    // Go to /login without remembering this page: the next person to sign in on this
    // browser shouldn't land on it.
    onSuccess: () => navigate('/login', { replace: true }),
  });

  // ----- Handlers -----
  const handleToggleColorScheme = () =>
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  const handleSignOut = () => signOut.mutate();

  // ----- Render -----
  const renderLink = ({ to, label, icon: Icon }) => (
    <NavLink
      key={to}
      component={Link}
      to={to}
      label={label}
      leftSection={<Icon size={18} stroke={1.6} />}
      active={isLinkActive(to, pathname)}
      onClick={closeNav}
    />
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle navigation"
            />
            <Link to="/tickets" className={classes.brand}>
              Resolvd
            </Link>
            {organization && (
              <Text c="dimmed" size="sm" visibleFrom="xs" truncate maw={220}>
                {organization.name}
              </Text>
            )}
          </Group>

          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="default"
              size="lg"
              onClick={handleToggleColorScheme}
              aria-label={computedColorScheme === 'dark' ? 'Use light mode' : 'Use dark mode'}
            >
              {computedColorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>

            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <UnstyledButton className={classes.userButton} aria-label="Account menu">
                  <Group gap="xs" wrap="nowrap">
                    <Avatar color="indigo" radius="xl" size={32}>
                      {initials(user?.name)}
                    </Avatar>
                    <Stack gap={0} visibleFrom="sm">
                      <Text size="sm" fw={500} lh={1.2}>
                        {user?.name}
                      </Text>
                      <Text size="xs" c="dimmed" lh={1.2}>
                        {ROLES[user?.role]?.label}
                      </Text>
                    </Stack>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  {user?.name} · {ROLES[user?.role]?.label}
                </Menu.Label>
                <Text size="xs" c="dimmed" px="sm" pb="xs" truncate>
                  {user?.email}
                </Text>
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconLogout size={16} />}
                  onClick={handleSignOut}
                  disabled={signOut.isPending}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {MAIN_LINKS.map(renderLink)}
        {isAdmin && (
          <>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="lg" mb={4} px="sm">
              Admin
            </Text>
            {ADMIN_LINKS.map(renderLink)}
          </>
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
