// Tests for the URL-name suggestion made from an organization name.
import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN, slugify } from './slug.js';

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('turns punctuation and repeated spaces into a single hyphen', () => {
    expect(slugify('Acme  &  Sons, Inc.')).toBe('acme-sons-inc');
  });

  it('removes accents instead of dropping the letter', () => {
    expect(slugify('Café Zürich')).toBe('cafe-zurich');
  });

  it('trims hyphens from both ends', () => {
    expect(slugify('  --Globex!!  ')).toBe('globex');
  });

  it('keeps numbers', () => {
    expect(slugify('District 9 Schools')).toBe('district-9-schools');
  });

  it('cuts to 50 characters without leaving a hyphen at the end', () => {
    const slug = slugify(`${'a'.repeat(49)} bcd`);
    expect(slug).toBe('a'.repeat(49));
    expect(slugify('word '.repeat(20)).length).toBeLessThanOrEqual(50);
    expect(slugify('word '.repeat(20)).endsWith('-')).toBe(false);
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('produces slugs the API accepts', () => {
    for (const name of ['Acme Corp', 'Northbridge Logistics', 'École Saint-Jean', 'IT & Co']) {
      expect(slugify(name)).toMatch(SLUG_PATTERN);
    }
  });
});
