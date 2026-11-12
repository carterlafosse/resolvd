// Sign-up page: creates a new organization and its first admin, then signs them in.
import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { registerOrganization } from '../../api/auth.js';
import { startSession, useAuth } from '../../auth/useAuth.js';
import { AuthShell } from './AuthShell.jsx';
import { SLUG_PATTERN, slugify } from './slug.js';

// The same limits as the API's registerOrgSchema. Checking here first matters because the API
// allows only 5 sign-up attempts per hour, and rejected ones count.
const validate = {
  organizationName: (value) =>
    value.trim().length >= 2 && value.trim().length <= 100 ? null : 'Use 2 to 100 characters',
  slug: (value) =>
    SLUG_PATTERN.test(value) ? null : 'Use 3 to 50 lowercase letters, numbers or hyphens',
  name: (value) => (value.trim() && value.trim().length <= 100 ? null : 'Enter your name'),
  email: (value) => (/^\S+@\S+\.\S+$/.test(value.trim()) ? null : 'Enter a valid email'),
  password: (value) => {
    if (value.length < 10) return 'Password must be at least 10 characters';
    if (value.length > 72) return 'Password must be at most 72 characters';
    if (!/[A-Za-z]/.test(value)) return 'Password must contain a letter';
    if (!/[0-9]/.test(value)) return 'Password must contain a number';
    return null;
  },
  confirmPassword: (value, values) => (value === values.password ? null : 'Passwords do not match'),
};

export function RegisterPage() {
  // ----- State -----
  // The URL name follows the organization name until the user edits it themselves.
  const [slugEdited, setSlugEdited] = useState(false);
  const form = useForm({
    initialValues: {
      organizationName: '',
      slug: '',
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    validate,
  });

  // ----- Data -----
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const signUp = useMutation({
    mutationFn: registerOrganization,
    meta: { inlineErrors: true },
    onSuccess: (session) => startSession(queryClient, session),
    // Field errors from the API (for example "That URL name is taken") go under their inputs.
    onError: (error) => form.setErrors(error.fieldErrors ?? {}),
  });

  // ----- Handlers -----
  const handleOrganizationNameChange = (event) => {
    const name = event.currentTarget.value;
    form.setFieldValue('organizationName', name);
    if (!slugEdited) form.setFieldValue('slug', slugify(name));
  };

  // Clearing the field hands it back to the automatic suggestion.
  const handleSlugChange = (event) => {
    const slug = event.currentTarget.value.toLowerCase();
    form.setFieldValue('slug', slug);
    setSlugEdited(slug !== '');
  };

  // confirmPassword is only checked here; the API doesn't take it.
  const handleSubmit = form.onSubmit(({ organizationName, slug, name, email, password }) =>
    signUp.mutate({ organizationName, slug, name, email, password }),
  );

  // ----- Render -----
  if (user) return <Navigate to="/tickets" replace />;

  // An error with field messages is already shown under the inputs.
  const fieldErrorCount = Object.keys(signUp.error?.fieldErrors ?? {}).length;
  const showErrorAlert = signUp.error && fieldErrorCount === 0;

  return (
    <AuthShell
      title="Create your organization"
      subtitle="Set up a private helpdesk for your company, school or club."
      footer={
        <Text ta="center" size="sm">
          Already have an account?{' '}
          <Anchor component={Link} to="/login">
            Sign in
          </Anchor>
        </Text>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {showErrorAlert && (
            <Alert color="red" variant="light" icon={<IconAlertCircle />}>
              {signUp.error.message}
            </Alert>
          )}

          <TextInput
            label="Organization name"
            placeholder="Acme Corp"
            {...form.getInputProps('organizationName')}
            onChange={handleOrganizationNameChange}
          />
          <TextInput
            label="URL name"
            description="A short name for your organization: lowercase letters, numbers and hyphens."
            placeholder="acme-corp"
            {...form.getInputProps('slug')}
            onChange={handleSlugChange}
          />
          <TextInput label="Your name" autoComplete="name" {...form.getInputProps('name')} />
          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Password"
            description="At least 10 characters, with a letter and a number."
            autoComplete="new-password"
            {...form.getInputProps('password')}
          />
          <PasswordInput
            label="Confirm password"
            autoComplete="new-password"
            {...form.getInputProps('confirmPassword')}
          />

          <Button type="submit" fullWidth loading={signUp.isPending}>
            Create organization
          </Button>
        </Stack>
      </form>
    </AuthShell>
  );
}
