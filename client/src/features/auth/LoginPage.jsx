// Sign-in page: email and password, then back to the page the user was trying to open.
import { Alert, Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { login } from '../../api/auth.js';
import { startSession, useAuth } from '../../auth/useAuth.js';
import { AuthShell } from './AuthShell.jsx';
import classes from './LoginPage.module.css';
import { usePageTitle } from '../../usePageTitle.js';

// Filled in when the public demo goes live (Phase 10): { role, email } for each demo account.
const DEMO_LOGINS = [];

// RequireAuth stores the page a signed-out visitor asked for in location.state.from.
function redirectTarget(location) {
  const from = location.state?.from;
  if (!from?.pathname || ['/login', '/register'].includes(from.pathname)) return '/tickets';
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

export function LoginPage() {
  // ----- State -----
  const location = useLocation();
  // Only checks that both fields are filled in, like the API: listing the password rules at
  // sign-in would tell an attacker what real passwords look like.
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (value) => (value.trim() ? null : 'Enter your email'),
      password: (value) => (value ? null : 'Enter your password'),
    },
  });

  // ----- Data -----
  usePageTitle('Sign in');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const signIn = useMutation({
    mutationFn: login,
    // Errors are shown in the alert below, not as a notification.
    meta: { inlineErrors: true },
    // Filling the ['me'] cache re-renders this page with a user, which redirects below.
    onSuccess: (session) => startSession(queryClient, session),
  });

  // ----- Handlers -----
  const handleSubmit = form.onSubmit((values) => signIn.mutate(values));

  // ----- Render -----
  if (user) return <Navigate to={redirectTarget(location)} replace />;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Sign in to your helpdesk."
      footer={
        <Stack gap="md">
          <Text ta="center" size="sm">
            New to Resolvd?{' '}
            <Anchor component={Link} to="/register">
              Create an organization
            </Anchor>
          </Text>

          <Paper withBorder p="md" radius="md">
            <Text fw={600} size="sm" mb={4}>
              Demo accounts
            </Text>
            {DEMO_LOGINS.length === 0 ? (
              <Text size="sm" c="dimmed">
                Demo accounts will be listed here when the live demo is set up.
              </Text>
            ) : (
              DEMO_LOGINS.map((demo) => (
                <Text key={demo.email} size="sm">
                  {demo.role}: {demo.email}
                </Text>
              ))
            )}
          </Paper>
        </Stack>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {signIn.error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle />}>
              {signIn.error.message}
            </Alert>
          )}

          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            {...form.getInputProps('password')}
          />

          <Button type="submit" fullWidth loading={signIn.isPending}>
            Sign in
          </Button>

          {/* The API is on a free Render plan that sleeps when idle. */}
          <Text size="xs" c="dimmed" ta="center">
            <IconInfoCircle size={14} className={classes.coldStartIcon} aria-hidden /> The first
            sign-in can take up to a minute while the server wakes up.
          </Text>
        </Stack>
      </form>
    </AuthShell>
  );
}
