// The API's rule for a category name (1 to 100 characters after trimming), shared by add and rename.
export const CATEGORY_NAME_MAX = 100;

export function validateCategoryName(value) {
  const length = value.trim().length;
  if (length === 0) return 'Enter a name';
  if (length > CATEGORY_NAME_MAX) return `Use at most ${CATEGORY_NAME_MAX} characters`;
  return null;
}
