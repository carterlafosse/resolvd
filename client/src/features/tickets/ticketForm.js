// Shared by the new ticket form and the edit form on the ticket page: the API's limits and wording.

// The same limits as the API's createTicketSchema, checked before sending so mistakes show
// under the field straight away.
export const TITLE_MIN = 5;
export const TITLE_MAX = 200;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 5000;

export function validateTitle(value) {
  const length = value.trim().length;
  if (length < TITLE_MIN) return `Use at least ${TITLE_MIN} characters`;
  if (length > TITLE_MAX) return `Use at most ${TITLE_MAX} characters`;
  return null;
}

export function validateDescription(value) {
  const length = value.trim().length;
  if (length < DESCRIPTION_MIN)
    return `Describe the problem in at least ${DESCRIPTION_MIN} characters`;
  if (length > DESCRIPTION_MAX) return `Use at most ${DESCRIPTION_MAX} characters`;
  return null;
}

// What each priority means, shown under the priority picker.
export const PRIORITY_HELP = {
  low: "A question or minor issue. Your work isn't blocked.",
  medium: "Something isn't working, but there's a workaround.",
  high: "You can't do an important part of your work.",
  critical: 'A key system is down or many people are affected.',
};

// Mantine Select wants string values; the API wants a number or null.
export const categoryOptions = (categories = []) =>
  categories.map((category) => ({ value: String(category.id), label: category.name }));
export const toCategoryId = (value) => (value ? Number(value) : null);
