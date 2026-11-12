// The API's password rules, checked in the browser for sign-up and for an admin adding a user.

// Same rules and wording as the API's passwordSchema. The API also checks the 72-byte bcrypt
// limit; 72 characters is the part a person can see.
export function validatePassword(value) {
  if (value.length < 10) return 'Password must be at least 10 characters';
  if (value.length > 72) return 'Password must be at most 72 characters';
  if (!/[A-Za-z]/.test(value)) return 'Password must contain a letter';
  if (!/[0-9]/.test(value)) return 'Password must contain a number';
  return null;
}

export const validateEmail = (value) =>
  /^\S+@\S+\.\S+$/.test(value.trim()) ? null : 'Enter a valid email';
