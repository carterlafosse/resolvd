// Coloured badge for a ticket status, using the labels and colours in constants.js.
import { Badge } from '@mantine/core';
import { STATUSES } from '../constants.js';

export function StatusBadge({ status, size = 'sm' }) {
  // ----- State -----
  // none

  // ----- Data -----
  const { label, color } = STATUSES[status] ?? { label: status, color: 'gray' };

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Badge color={color} variant="light" size={size}>
      {label}
    </Badge>
  );
}
