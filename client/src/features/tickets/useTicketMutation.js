// A mutation for any change to a ticket: after it succeeds, every cached ticket query refreshes.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ticketKeys } from '../../api/tickets.js';

// One change can affect the ticket (status, deadlines, allowed actions), its activity feed and
// every queue it appears in, so all of them are invalidated: ['tickets'] is the prefix of every
// ticket query key. Waiting for the refetch keeps the control busy until the page shows the
// new state, so a select doesn't jump back to the old value for a moment.
export function useTicketMutation(mutationFn, { onSuccess, ...options } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      onSuccess?.(...args);
    },
  });
}
