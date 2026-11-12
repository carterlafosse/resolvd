// Top of the ticket page: id, title, badges and description, with an inline edit form when allowed.
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconPencil } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { categoryKeys, listCategories } from '../../api/categories.js';
import { updateTicket } from '../../api/tickets.js';
import { PriorityBadge } from '../../components/PriorityBadge.jsx';
import { SlaBadge } from '../../components/SlaBadge.jsx';
import { overallClock } from '../../components/sla.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import {
  categoryOptions,
  DESCRIPTION_MAX,
  TITLE_MAX,
  toCategoryId,
  validateDescription,
  validateTitle,
} from './ticketForm.js';
import classes from './TicketHeader.module.css';
import { useTicketMutation } from './useTicketMutation.js';

export function TicketHeader({ ticket, onReload }) {
  // ----- State -----
  // The updated_at the edit started from. Captured when editing begins, not read at save time:
  // the ticket refetches in the background (window focus), and sending the newer value would
  // hide someone else's change instead of reporting it with a 409.
  const [editingFrom, setEditingFrom] = useState(null);
  const form = useForm({
    initialValues: { title: '', categoryId: null, description: '' },
    validate: { title: validateTitle, description: validateDescription },
  });

  // ----- Data -----
  const isEditing = editingFrom !== null;
  const categories = useQuery({
    queryKey: categoryKeys.all,
    queryFn: ({ signal }) => listCategories({ signal }),
    enabled: isEditing,
  });
  const save = useTicketMutation((values) => updateTicket(ticket.id, values), {
    onSuccess: () => setEditingFrom(null),
    onError: (error) => form.setErrors(error.fieldErrors ?? {}),
  });
  const isConflict = save.error?.status === 409;

  // ----- Handlers -----
  const handleEdit = () => {
    form.setValues({
      title: ticket.title,
      categoryId: ticket.category_id ? String(ticket.category_id) : null,
      description: ticket.description,
    });
    form.resetDirty();
    save.reset();
    setEditingFrom(ticket.updated_at);
  };
  const handleCancel = () => setEditingFrom(null);
  const handleSubmit = form.onSubmit(({ title, categoryId, description }) =>
    save.mutate({
      title,
      description,
      categoryId: toCategoryId(categoryId),
      expectedUpdatedAt: editingFrom,
    }),
  );
  // Throws the edit away and loads the ticket as it is now; the user can then edit again.
  const handleReload = () => {
    setEditingFrom(null);
    onReload();
  };

  // ----- Render -----
  const heading = (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap={6}>
        <Text c="dimmed" fw={600} size="sm">
          {ticket.display_id}
        </Text>
        {!isEditing && (
          <Title order={2} className={classes.title}>
            {ticket.title}
          </Title>
        )}
        <Group gap={6}>
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <SlaBadge {...overallClock(ticket)} />
        </Group>
      </Stack>
      {ticket.canEdit && !isEditing && (
        <Button variant="default" leftSection={<IconPencil size={16} />} onClick={handleEdit}>
          Edit
        </Button>
      )}
    </Group>
  );

  if (!isEditing) {
    return (
      <Paper withBorder p="lg">
        {heading}
        <Text mt="md" className={classes.description}>
          {ticket.description}
        </Text>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="lg">
      {heading}
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md" mt="md">
          {isConflict && (
            <Alert
              color="orange"
              variant="light"
              icon={<IconAlertTriangle />}
              title="This ticket was changed by someone else"
            >
              <Stack gap="xs" align="flex-start">
                <Text size="sm">
                  Your changes weren't saved. Reload to see the latest version, then edit again.
                </Text>
                <Button size="xs" variant="light" color="orange" onClick={handleReload}>
                  Reload ticket
                </Button>
              </Stack>
            </Alert>
          )}
          <TextInput label="Title" maxLength={TITLE_MAX} {...form.getInputProps('title')} />
          <Select
            label="Category"
            placeholder="No category"
            data={categoryOptions(categories.data?.data)}
            clearable
            searchable
            {...form.getInputProps('categoryId')}
          />
          <Textarea
            label="Description"
            autosize
            minRows={4}
            maxRows={14}
            maxLength={DESCRIPTION_MAX}
            {...form.getInputProps('description')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={isConflict}>
              Save changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
