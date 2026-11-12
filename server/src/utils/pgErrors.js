// Helpers for recognising specific PostgreSQL errors so services can turn them into clear messages.

// 23505 is unique_violation; err.constraint names the index or constraint that was hit.
export function isUniqueViolation(err, constraint) {
  return err?.code === '23505' && err.constraint === constraint;
}

// Same shape as a flattened ZodError, so the front end shows every field error the same way.
export function fieldError(field, message) {
  return { formErrors: [], fieldErrors: { [field]: [message] } };
}
