// New ticket form: title, category, priority and description, then straight to the new ticket.
import {
  Button,
  Group,
  Input,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { categoryKeys, listCategories } from '../../api/categories.js';
import { createTicket, ticketKeys } from '../../api/tickets.js';
import { useAuth } from '../../auth/useAuth.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { PRIORITIES } from '../../constants.js';
import {
  categoryOptions,
  DESCRIPTION_MAX,
  PRIORITY_HELP,
  TITLE_MAX,
  toCategoryId,
  validateDescription,
  validateTitle,
} from './ticketForm.js';
import classes from './NewTicketPage.module.css';
import { usePageTitle } from '../../usePageTitle.js';

export function NewTicketPage() {
  // ----- State -----
  const navigate = useNavigate();
  const form = useForm({
    initialValues: { title: '', categoryId: null, priority: 'medium', description: '' },
    validate: { title: validateTitle, description: validateDescription },
  });

  // ----- Data -----
  usePageTitle('New ticket');
  const queryClient = useQueryClient();
  const { isStaff } = useAuth();
  const categories = useQuery({
    queryKey: categoryKeys.all,
    queryFn: ({ signal }) => listCategories({ signal }),
  });
  const create = useMutation({
    mutationFn: createTicket,
    onSuccess: (ticket) => {
      notifications.show({ color: 'green', message: `${ticket.display_id} created` });
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      navigate(`/tickets/${ticket.id}`);
    },
    // The global handler shows the message; field errors also go under their inputs.
    onError: (error) => form.setErrors(error.fieldErrors ?? {}),
  });
  // Critical is for staff only (the API refuses it from end users with 403).
  const priorityOptions = Object.entries(PRIORITIES)
    .filter(([value]) => isStaff || value !== 'critical')
    .map(([value, { label }]) => ({ value, label }));

  // ----- Handlers -----
  const handleSubmit = form.onSubmit(({ title, categoryId, priority, description }) =>
    create.mutate({ title, description, priority, categoryId: toCategoryId(categoryId) }),
  );

  // ----- Render -----
  return (
    <>
      <PageHeader title="New ticket" description="Tell IT support what's going wrong." />

      <Paper withBorder p="lg" className={classes.formCard}>
        <form onSubmit={handleSubmit} noValidate>
          <Stack gap="md">
            <TextInput
              label="Title"
              placeholder="Laptop won't connect to the VPN"
              withAsterisk
              maxLength={TITLE_MAX}
              {...form.getInputProps('title')}
            />

            <Select
              label="Category"
              placeholder={categories.isPending ? 'Loading categories…' : 'Choose a category'}
              data={categoryOptions(categories.data?.data)}
              clearable
              searchable
              {...form.getInputProps('categoryId')}
            />

            <Input.Wrapper
              label="Priority"
              description={PRIORITY_HELP[form.values.priority]}
              inputWrapperOrder={['label', 'input', 'description']}
            >
              <SegmentedControl
                fullWidth
                data={priorityOptions}
                aria-label="Priority"
                {...form.getInputProps('priority')}
              />
            </Input.Wrapper>

            <Textarea
              label="Description"
              placeholder="What happened, what you expected, and anything you've already tried."
              withAsterisk
              autosize
              minRows={5}
              maxRows={14}
              maxLength={DESCRIPTION_MAX}
              description={`${form.values.description.length} / ${DESCRIPTION_MAX}`}
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              {...form.getInputProps('description')}
            />

            <Group justify="flex-end">
              <Button variant="default" component={Link} to="/tickets">
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Submit ticket
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </>
  );
}
