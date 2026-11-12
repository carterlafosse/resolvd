// Page-number pagination: turns ?page and ?pageSize into LIMIT/OFFSET and builds the response block.

export function toLimitOffset({ page, pageSize }) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

// The `pagination` object every paginated list returns next to `data`.
export function buildPagination({ page, pageSize, total }) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
