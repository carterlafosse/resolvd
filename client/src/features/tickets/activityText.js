// Turns a ticket event from the activity feed into one readable sentence.
import { PRIORITIES, STATUSES } from '../../constants.js';
import { fullDate } from '../../dates.js';

const statusLabel = (value) => STATUSES[value]?.label ?? value;
const priorityLabel = (value) => PRIORITIES[value]?.label ?? value;
const deadline = (value) => (value ? fullDate(value) : 'none');

// The item is an activity row: { actor_name, field, old_value, new_value }. Assignment and
// category events already store names, so nothing needs looking up.
export function describeEvent({ actor_name: name, field, old_value: from, new_value: to }) {
  switch (field) {
    case 'created':
      return `${name} created the ticket`;
    case 'status':
      return `${name} changed the status from ${statusLabel(from)} to ${statusLabel(to)}`;
    case 'priority':
      return `${name} changed the priority from ${priorityLabel(from)} to ${priorityLabel(to)}`;
    case 'assignee':
      if (to === 'Unassigned') return `${name} unassigned ${from}`;
      if (from === 'Unassigned') return `${name} assigned the ticket to ${to}`;
      return `${name} reassigned the ticket from ${from} to ${to}`;
    case 'title':
      return `${name} renamed the ticket to "${to}"`;
    case 'description':
      return `${name} edited the description`;
    case 'category':
      return `${name} changed the category from ${from ?? 'None'} to ${to ?? 'None'}`;
    case 'response_due_at':
      return `Response deadline changed to ${deadline(to)}`;
    case 'resolution_due_at':
      return `Resolution deadline changed to ${deadline(to)}`;
    case 'sla_breach':
      return `${to === 'response' ? 'Response' : 'Resolution'} SLA breached`;
    default:
      return `${name} changed ${field}`;
  }
}
