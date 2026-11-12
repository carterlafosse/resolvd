// One ticket's details and activity. Placeholder until Phase 8 builds it.
import { Text } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';

export function TicketDetailPage() {
  // ----- State -----
  const { id } = useParams();

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <>
      <PageHeader title={`Ticket ${id}`} />
      <Text c="dimmed">The ticket detail page is coming soon.</Text>
    </>
  );
}
