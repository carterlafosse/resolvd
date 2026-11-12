// Labels and colours for ticket statuses, priorities and user roles, in the API's enum order.

// Mantine colour names. Every badge and select reads from here, so a status always looks the
// same everywhere.
export const STATUSES = {
  open: { label: 'Open', color: 'blue' },
  in_progress: { label: 'In progress', color: 'violet' },
  on_hold: { label: 'On hold', color: 'yellow' },
  resolved: { label: 'Resolved', color: 'green' },
  closed: { label: 'Closed', color: 'gray' },
};

export const PRIORITIES = {
  low: { label: 'Low', color: 'gray' },
  medium: { label: 'Medium', color: 'blue' },
  high: { label: 'High', color: 'orange' },
  critical: { label: 'Critical', color: 'red' },
};

export const ROLES = {
  end_user: { label: 'End user' },
  technician: { label: 'Technician' },
  admin: { label: 'Admin' },
};

// Matches the API's STAFF_ROLES: who works the queue.
export const STAFF_ROLES = ['technician', 'admin'];
