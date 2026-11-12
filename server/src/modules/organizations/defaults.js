// Categories and SLA policies every new organization starts with (used by sign-up and the seeds).

export const DEFAULT_CATEGORIES = [
  'Hardware',
  'Software',
  'Network',
  'Account Access',
  'Email',
  'Other',
];

// Minutes from ticket creation: first response due, then resolution due.
export const DEFAULT_SLA_POLICIES = [
  { priority: 'critical', responseMinutes: 60, resolutionMinutes: 240 }, // 1 h / 4 h
  { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 }, // 4 h / 1 day
  { priority: 'medium', responseMinutes: 480, resolutionMinutes: 2880 }, // 8 h / 2 days
  { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 }, // 1 day / 5 days
];
