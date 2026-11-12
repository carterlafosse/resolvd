// Modal form for an admin to add a user with a role and a temporary password.
import { Button, Group, Modal, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser, userKeys } from '../../api/users.js';
import { ROLES } from '../../constants.js';
import { validateEmail, validatePassword } from '../auth/passwordRules.js';

const ROLE_OPTIONS = Object.entries(ROLES).map(([value, { label }]) => ({ value, label }));

const INITIAL_VALUES = { name: '', email: '', role: 'end_user', department: '', password: '' };

export function AddUserModal({ opened, onClose }) {
  // ----- State -----
  const form = useForm({
    initialValues: INITIAL_VALUES,
    validate: {
      name: (value) => (value.trim() && value.trim().length <= 100 ? null : 'Enter a name'),
      email: validateEmail,
      department: (value) => (value.trim().length <= 100 ? null : 'Use at most 100 characters'),
      password: validatePassword,
    },
  });

  // ----- Data -----
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createUser,
    onSuccess: (user) => {
      notifications.show({ color: 'green', message: `${user.name} added` });
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      form.reset();
      onClose();
    },
    // "That email is already in use" goes under the email field.
    onError: (error) => form.setErrors(error.fieldErrors ?? {}),
  });

  // ----- Handlers -----
  const handleClose = () => {
    form.reset();
    onClose();
  };
  const handleSubmit = form.onSubmit((values) =>
    create.mutate({ ...values, department: values.department.trim() || null }),
  );

  // ----- Render -----
  return (
    <Modal opened={opened} onClose={handleClose} title="Add user">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
          <TextInput label="Email" type="email" withAsterisk {...form.getInputProps('email')} />
          <Select
            label="Role"
            data={ROLE_OPTIONS}
            allowDeselect={false}
            {...form.getInputProps('role')}
          />
          <TextInput label="Department" {...form.getInputProps('department')} />
          <PasswordInput
            label="Temporary password"
            description="At least 10 characters, with a letter and a number."
            withAsterisk
            autoComplete="new-password"
            {...form.getInputProps('password')}
          />
          <Text size="xs" c="dimmed">
            Share the password with them privately. They can change it after signing in.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add user
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
