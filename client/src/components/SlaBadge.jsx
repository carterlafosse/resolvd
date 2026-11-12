// Badge for one SLA clock ("Due in 2h", "At risk, 25m left", "Breached 1h ago", "Met"), with the
// exact deadline in a tooltip.
import { Badge, Tooltip } from '@mantine/core';
import { SLA_STATES } from '../constants.js';
import { fullDate } from '../dates.js';
import { slaLabel } from './sla.js';

// name: "Response" or "Resolution", used in the tooltip.
export function SlaBadge({ state = 'none', dueAt, name, size = 'sm' }) {
  // ----- State -----
  // none

  // ----- Data -----
  const { color } = SLA_STATES[state] ?? SLA_STATES.none;
  const label = slaLabel(state, dueAt);
  const tooltip = dueAt ? `${name ? `${name} due` : 'Due'} ${fullDate(dueAt)}` : null;

  // ----- Handlers -----
  // none

  // ----- Render -----
  const badge = (
    <Badge color={color} variant="light" size={size}>
      {label}
    </Badge>
  );
  if (!tooltip) return badge;
  return (
    <Tooltip label={tooltip} withArrow>
      {badge}
    </Tooltip>
  );
}
