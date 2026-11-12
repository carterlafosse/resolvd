// Admin: ticket categories. Add a new one at the top; rename any of them inline.
import { Alert, Button, Group, Paper, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryKeys, createCategory, listCategories } from '../../api/categories.js';
import { EmptyState } from '../../components/EmptyState.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import classes from './AdminCategoriesPage.module.css';
import { CATEGORY_NAME_MAX, validateCategoryName } from './categoryName.js';
import { CategoryRow } from './CategoryRow.jsx';

export function AdminCategoriesPage() {
  // ----- State -----
  const form = useForm({
    initialValues: { name: '' },
    validate: { name: validateCategoryName },
  });

  // ----- Data -----
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: categoryKeys.all,
    queryFn: ({ signal }) => listCategories({ signal }),
  });
  const add = useMutation({
    mutationFn: ({ name }) => createCategory(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoryKeys.all });
      form.reset();
    },
    onError: (error) => form.setErrors(error.fieldErrors ?? {}),
  });
  const list = categories.data?.data ?? [];

  // ----- Handlers -----
  const handleSubmit = form.onSubmit((values) => add.mutate(values));

  // ----- Render -----
  return (
    <>
      <PageHeader
        title="Categories"
        description="Requesters pick one of these when they submit a ticket."
      />

      <Stack gap="md" className={classes.content}>
        <Paper withBorder p="md">
          <form onSubmit={handleSubmit} noValidate>
            <Group gap="sm" align="flex-start" wrap="nowrap">
              <TextInput
                className={classes.addInput}
                aria-label="New category name"
                placeholder="New category, for example Printers"
                maxLength={CATEGORY_NAME_MAX}
                {...form.getInputProps('name')}
              />
              <Button type="submit" leftSection={<IconPlus size={16} />} loading={add.isPending}>
                Add
              </Button>
            </Group>
          </form>
        </Paper>

        {categories.isError ? (
          <Alert color="red" variant="light" icon={<IconAlertCircle />}>
            {categories.error.message}
          </Alert>
        ) : (
          <Paper withBorder>
            {categories.isPending ? (
              <Stack p="md" gap="sm">
                <Skeleton height={20} />
                <Skeleton height={20} />
                <Skeleton height={20} />
              </Stack>
            ) : list.length === 0 ? (
              <EmptyState title="No categories yet" description="Add the first one above." />
            ) : (
              list.map((category) => <CategoryRow key={category.id} category={category} />)
            )}
          </Paper>
        )}

        <Text size="xs" c="dimmed">
          Categories can't be deleted, so existing tickets always keep theirs. Renaming one updates
          every ticket that uses it; the history keeps the name it had at the time.
        </Text>
      </Stack>
    </>
  );
}
