// Reply box under the activity feed. Staff can switch it to an internal note; nobody can comment
// once the ticket is closed.
import { Button, Group, Paper, Stack, Switch, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { addComment } from '../../api/tickets.js';
import classes from './CommentBox.module.css';
import { useTicketMutation } from './useTicketMutation.js';

// The API's limit for a comment body.
const BODY_MAX = 5000;

export function CommentBox({ ticketId, canComment, isStaff }) {
  // ----- State -----
  const form = useForm({
    initialValues: { body: '', isInternal: false },
    validate: { body: (value) => (value.trim() ? null : 'Write a message first') },
  });

  // ----- Data -----
  const post = useTicketMutation((values) => addComment(ticketId, values), {
    onSuccess: () => form.reset(),
  });
  const isInternal = isStaff && form.values.isInternal;

  // ----- Handlers -----
  const handleSubmit = form.onSubmit(({ body, isInternal: internal }) =>
    post.mutate({ body, isInternal: isStaff && internal }),
  );

  // ----- Render -----
  return (
    <Paper withBorder p="md" className={isInternal ? classes.internalMode : undefined}>
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="sm">
          <Textarea
            label={isInternal ? 'Internal note' : 'Reply'}
            placeholder={isInternal ? 'Only support staff will see this note.' : 'Write a reply…'}
            description={canComment ? null : 'This ticket is closed. Please submit a new one.'}
            disabled={!canComment}
            autosize
            minRows={3}
            maxRows={12}
            maxLength={BODY_MAX}
            {...form.getInputProps('body')}
          />
          <Group justify={isStaff ? 'space-between' : 'flex-end'}>
            {isStaff && (
              <Switch
                label="Internal note"
                color="yellow"
                disabled={!canComment}
                {...form.getInputProps('isInternal', { type: 'checkbox' })}
              />
            )}
            <Button
              type="submit"
              color={isInternal ? 'yellow' : undefined}
              loading={post.isPending}
              disabled={!canComment}
            >
              {isInternal ? 'Add internal note' : 'Send reply'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
