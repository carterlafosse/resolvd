// The one place the front end talks to the API: builds the URL, sends cookies, parses errors.

// Every API error the UI sees, whatever went wrong. `status` is 0 when the server couldn't be
// reached at all.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  // The API sends field errors as { fieldErrors: { email: ['...'] } } (validation and
  // conflict errors). Forms want { email: '...' }: the first message for each field.
  get fieldErrors() {
    const fields = this.details?.fieldErrors ?? {};
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([, messages]) => Array.isArray(messages) && messages.length > 0)
        .map(([field, messages]) => [field, messages[0]]),
    );
  }
}

const UNREACHABLE_MESSAGE = "Can't reach the server. Check your connection and try again.";

// Leaves out empty values so optional filters don't appear as `?status=`. Arrays become
// comma-separated lists, which is how the tickets endpoint takes several statuses.
export function buildQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

// Turns a failed response into an ApiError. The API always answers with
// { error: { code, message, details? } }. Anything else (for example the dev proxy's error
// page when the API isn't running) gets a generic message based on the status.
export async function toApiError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: use the generic message below.
  }
  const error = body?.error;
  if (typeof error?.code === 'string' && typeof error?.message === 'string') {
    return new ApiError(response.status, error.code, error.message, error.details);
  }
  if (response.status >= 500) {
    return new ApiError(response.status, 'SERVER_ERROR', UNREACHABLE_MESSAGE);
  }
  return new ApiError(response.status, 'HTTP_ERROR', `Request failed (${response.status})`);
}

// api('/tickets', { query: { status: ['open'] } }) returns the parsed JSON or throws ApiError.
// Paths are relative to /api, which Vite (dev) and Vercel (production) forward to the server,
// so the browser only ever calls its own origin and the session cookie goes along.
export async function api(path, { method = 'GET', body, query, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`/api${path}${buildQueryString(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (err) {
    // TanStack Query cancels queries it no longer needs; that's not an error to show.
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', UNREACHABLE_MESSAGE);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return null;
  return response.json();
}
