// Tests for the API client: URLs, cookies, success bodies and turning failures into ApiError.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildQueryString } from './client.js';

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockFetch(implementation) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildQueryString', () => {
  it('leaves out empty values and joins arrays with commas', () => {
    const text = buildQueryString({
      status: ['open', 'on_hold'],
      priority: [],
      search: '',
      assignee: null,
      categoryId: undefined,
      page: 2,
    });
    expect(text).toBe('?status=open%2Con_hold&page=2');
  });

  it('returns an empty string when nothing is set', () => {
    expect(buildQueryString({ search: '' })).toBe('');
    expect(buildQueryString()).toBe('');
  });
});

describe('api', () => {
  it('calls /api with cookies included and returns the parsed body', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, { data: [] }));

    const result = await api('/tickets', { query: { status: ['open'] } });

    expect(result).toEqual({ data: [] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tickets?status=open');
    expect(options.method).toBe('GET');
    expect(options.credentials).toBe('include');
    expect(options.body).toBeUndefined();
  });

  it('sends a JSON body with its content type', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(201, { id: 1 }));

    await api('/categories', { method: 'POST', body: { name: 'Printers' } });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.body).toBe('{"name":"Printers"}');
  });

  it('returns null for 204 No Content', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeNull();
  });

  it("turns the API's error body into an ApiError with status, code and details", async () => {
    const details = {
      formErrors: [],
      fieldErrors: { slug: ['That URL name is taken'], email: [] },
    };
    mockFetch(async () =>
      jsonResponse(409, {
        error: { code: 'CONFLICT', message: 'That URL name is taken', details },
      }),
    );

    const error = await api('/auth/register-organization', { method: 'POST', body: {} }).catch(
      (err) => err,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('That URL name is taken');
    expect(error.details).toEqual(details);
    // One message per field, and fields without messages are left out.
    expect(error.fieldErrors).toEqual({ slug: 'That URL name is taken' });
  });

  it('gives a generic message when a 5xx response is not JSON (API down behind the proxy)', async () => {
    mockFetch(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));

    const error = await api('/health').catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toMatch(/can't reach the server/i);
  });

  it('gives a status-based message for a 4xx response without the error shape', async () => {
    mockFetch(async () => jsonResponse(404, { something: 'else' }));

    const error = await api('/nope').catch((err) => err);

    expect(error.status).toBe(404);
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.message).toBe('Request failed (404)');
    expect(error.fieldErrors).toEqual({});
  });

  it('reports a network failure as status 0', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await api('/auth/me').catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('lets a cancelled request through unchanged', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    const error = await api('/tickets').catch((err) => err);

    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.name).toBe('AbortError');
  });
});
