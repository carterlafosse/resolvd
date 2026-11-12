// Converting SLA times between the API's minutes and the hours or days an admin types.

export const MINUTES_PER_UNIT = { hours: 60, days: 24 * 60 };

// The API's limits for a policy time.
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 90 * 24 * 60;

// Whole days read as days ("3 days"); anything else as hours, which may be fractional
// (30 minutes is 0.5 hours).
export function fromMinutes(minutes) {
  if (minutes >= MINUTES_PER_UNIT.days && minutes % MINUTES_PER_UNIT.days === 0) {
    return { value: minutes / MINUTES_PER_UNIT.days, unit: 'days' };
  }
  return { value: Number((minutes / MINUTES_PER_UNIT.hours).toFixed(2)), unit: 'hours' };
}

// Rounded to whole minutes, which is what the API stores.
export function toMinutes(value, unit) {
  return Math.round(Number(value) * MINUTES_PER_UNIT[unit]);
}

// Checks one policy row the way the API will. Returns { response?, resolution? } messages.
export function policyErrors(responseMinutes, resolutionMinutes) {
  const errors = {};
  const range = (minutes) =>
    !Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES
      ? 'Use 5 minutes to 90 days'
      : null;
  const responseError = range(responseMinutes);
  const resolutionError = range(resolutionMinutes);
  if (responseError) errors.response = responseError;
  if (resolutionError) errors.resolution = resolutionError;
  if (!responseError && !resolutionError && responseMinutes >= resolutionMinutes) {
    errors.resolution = 'Must be longer than the response time';
  }
  return errors;
}
