// Shared id schemas: positive integers within PostgreSQL's INT range, from text or JSON.
import { describe, expect, it } from 'vitest';
import { idParam, idParams, idValue, PG_INT_MAX } from '../../src/utils/idSchemas.js';

describe('idParam (path and query text)', () => {
  it('coerces numeric text up to the INT maximum', () => {
    expect(idParam.parse('1')).toBe(1);
    expect(idParam.parse(String(PG_INT_MAX))).toBe(PG_INT_MAX);
  });

  it.each(['0', '-1', '1.5', 'abc', '', String(PG_INT_MAX + 1), '99999999999'])(
    'rejects %j',
    (value) => {
      expect(idParam.safeParse(value).success).toBe(false);
    },
  );
});

describe('idValue (JSON bodies)', () => {
  it('accepts numbers only, within range', () => {
    expect(idValue.parse(PG_INT_MAX)).toBe(PG_INT_MAX);
    expect(idValue.safeParse('5').success).toBe(false);
    expect(idValue.safeParse(PG_INT_MAX + 1).success).toBe(false);
    expect(idValue.safeParse(0).success).toBe(false);
  });
});

describe('idParams', () => {
  it('parses { id } from route params', () => {
    expect(idParams.parse({ id: '42' })).toEqual({ id: 42 });
    expect(idParams.safeParse({ id: '2147483648' }).success).toBe(false);
  });
});
