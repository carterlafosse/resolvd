// Turns an organization name into a suggested URL name ("Acme Corp." → "acme-corp").

// The API accepts 3 to 50 lowercase letters, numbers or hyphens.
export const SLUG_PATTERN = /^[a-z0-9-]{3,50}$/;
const SLUG_MAX_LENGTH = 50;

export function slugify(text) {
  return (
    text
      // Split accented letters into letter + accent, then drop the accent: "Café" → "Cafe".
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Any run of other characters (spaces, punctuation, symbols) becomes one hyphen.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // Cut to the maximum, then drop a hyphen the cut may have left at the end.
      .slice(0, SLUG_MAX_LENGTH)
      .replace(/-+$/, '')
  );
}
