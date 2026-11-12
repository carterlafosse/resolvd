// Admin: SLA response and resolution times for each priority.
import { Alert, Skeleton, Stack } from '@mantine/core';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { listSlaPolicies, slaKeys } from '../../api/sla.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import classes from './AdminSlaPage.module.css';
import { SlaPolicyRow } from './SlaPolicyRow.jsx';

export function AdminSlaPage() {
  // ----- State -----
  // none

  // ----- Data -----
  const policies = useQuery({
    queryKey: slaKeys.all,
    queryFn: ({ signal }) => listSlaPolicies({ signal }),
  });

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <>
      <PageHeader
        title="SLA policies"
        description="How quickly support must first reply to, and resolve, each priority."
      />

      <Stack gap="md" className={classes.content}>
        {/* Deadlines are stored on each ticket when it's created, so editing a policy doesn't
            move deadlines already promised. */}
        <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
          Changes apply to new tickets, and to existing tickets when their priority changes.
          Deadlines already set on other tickets stay as they are. Times run around the clock
          (24/7).
        </Alert>

        {policies.isError ? (
          <Alert color="red" variant="light" icon={<IconAlertCircle />}>
            {policies.error.message}
          </Alert>
        ) : policies.isPending ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={120} />)
        ) : (
          policies.data.data.map((policy) => (
            <SlaPolicyRow key={`${policy.priority}-${policy.updated_at}`} policy={policy} />
          ))
        )}
      </Stack>
    </>
  );
}
