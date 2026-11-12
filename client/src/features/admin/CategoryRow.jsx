// One category in the admin list: its name, or an inline rename form while editing.
import { ActionIcon, Group, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCheck, IconPencil, IconX } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { categoryKeys, renameCategory } from '../../api/categories.js';
import { CATEGORY_NAME_MAX, validateCategoryName } from './categoryName.js';
import classes from './CategoryRow.module.css';

export function CategoryRow({ category }) {
  // ----- State -----
  const [isEditing, setIsEditing] = useState(false);
  const form = useForm({
    initialValues: { name: category.name },
    validate: { name: validateCategoryName },
  });

  // ----- Data -----
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: ({ name }) => renameCategory(category.id, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoryKeys.all });
      setIsEditing(false);
    },
    // "A category with that name already exists" shows under the input.
    onError: (error) => form.setErrors(error.fieldErrors ?? {}),
  });

  // ----- Handlers -----
  const handleEdit = () => {
    form.setValues({ name: category.name });
    form.clearErrors();
    setIsEditing(true);
  };
  const handleCancel = () => setIsEditing(false);
  const handleSubmit = form.onSubmit((values) => {
    if (values.name.trim() === category.name) return setIsEditing(false);
    rename.mutate(values);
  });
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') handleCancel();
  };

  // ----- Render -----
  if (!isEditing) {
    return (
      <Group justify="space-between" className={classes.categoryRow} wrap="nowrap">
        <Text size="sm">{category.name}</Text>
        <ActionIcon variant="subtle" onClick={handleEdit} aria-label={`Rename ${category.name}`}>
          <IconPencil size={16} />
        </ActionIcon>
      </Group>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={classes.categoryRow}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <TextInput
          className={classes.nameInput}
          aria-label={`New name for ${category.name}`}
          maxLength={CATEGORY_NAME_MAX}
          size="xs"
          autoFocus
          onKeyDown={handleKeyDown}
          {...form.getInputProps('name')}
        />
        <ActionIcon type="submit" loading={rename.isPending} aria-label="Save name">
          <IconCheck size={16} />
        </ActionIcon>
        <ActionIcon variant="default" onClick={handleCancel} aria-label="Cancel rename">
          <IconX size={16} />
        </ActionIcon>
      </Group>
    </form>
  );
}
