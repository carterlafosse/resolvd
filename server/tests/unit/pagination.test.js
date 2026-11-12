// Pagination helper: LIMIT/OFFSET from page numbers, and the pagination block in list responses.
import { describe, expect, it } from 'vitest';
import { buildPagination, toLimitOffset } from '../../src/utils/pagination.js';

describe('toLimitOffset', () => {
  it('starts page 1 at offset 0', () => {
    expect(toLimitOffset({ page: 1, pageSize: 25 })).toEqual({ limit: 25, offset: 0 });
  });

  it('skips the earlier pages', () => {
    expect(toLimitOffset({ page: 3, pageSize: 10 })).toEqual({ limit: 10, offset: 20 });
  });
});

describe('buildPagination', () => {
  it.each([
    [0, 0],
    [1, 1],
    [25, 1],
    [26, 2],
    [132, 6],
  ])('%i results at 25 per page is %i pages', (total, totalPages) => {
    expect(buildPagination({ page: 1, pageSize: 25, total })).toEqual({
      page: 1,
      pageSize: 25,
      total,
      totalPages,
    });
  });
});
