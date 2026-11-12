// Coloured badge for a ticket priority. Critical gets a warning icon so it stands out in a list.
import { Badge } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { PRIORITIES } from '../constants.js';

export function PriorityBadge({ priority, size = 'sm' }) {
  // ----- State -----
  // none

  // ----- Data -----
  const { label, color } = PRIORITIES[priority] ?? { label: priority, color: 'gray' };
  const isCritical = priority === 'critical';

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Badge
      color={color}
      variant={isCritical ? 'filled' : 'light'}
      size={size}
      leftSection={isCritical ? <IconAlertTriangle size={12} aria-hidden /> : null}
    >
      {label}
    </Badge>
  );
}
