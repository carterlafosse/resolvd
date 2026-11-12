// Tests for the sign-up form: the automatic URL name and showing API field errors.
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSession, renderWithProviders } from '../../test/renderWithProviders.jsx';
import { RegisterPage } from './RegisterPage.jsx';

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RegisterPage', () => {
  it('suggests a URL name from the organization name until the user edits it', () => {
    vi.stubGlobal('fetch', vi.fn(mockSession(null)));
    renderWithProviders(<RegisterPage />, { route: '/register' });

    type('Organization name', 'Café Zürich Ltd');
    expect(screen.getByLabelText('URL name').value).toBe('cafe-zurich-ltd');

    type('URL name', 'Zurich');
    type('Organization name', 'Something Else');
    expect(screen.getByLabelText('URL name').value).toBe('zurich');

    // Clearing the URL name turns the suggestion back on.
    type('URL name', '');
    type('Organization name', 'Globex');
    expect(screen.getByLabelText('URL name').value).toBe('globex');
  });

  it("shows the API's field error under the matching input", async () => {
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).startsWith('/api/auth/register-organization')) {
        expect(JSON.parse(options.body)).not.toHaveProperty('confirmPassword');
        return Response.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That URL name is taken',
              details: { formErrors: [], fieldErrors: { slug: ['That URL name is taken'] } },
            },
          },
          { status: 409 },
        );
      }
      return mockSession(null)(url);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<RegisterPage />, { route: '/register' });

    type('Organization name', 'Acme Corp');
    type('Your name', 'Pat Example');
    type('Email', 'pat@example.com');
    type('Password', 'correct horse 42');
    type('Confirm password', 'correct horse 42');
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    const urlInput = screen.getByLabelText('URL name');
    expect(await screen.findByText('That URL name is taken')).toBeTruthy();
    expect(urlInput.getAttribute('aria-invalid')).toBe('true');
    // Shown once, under the field, not again in an alert.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('checks the form before calling the API', async () => {
    const fetchMock = vi.fn(mockSession(null));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<RegisterPage />, { route: '/register' });

    type('Organization name', 'Acme Corp');
    type('Your name', 'Pat Example');
    type('Email', 'pat@example.com');
    type('Password', 'short1');
    type('Confirm password', 'different');
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Password must be at least 10 characters')).toBeTruthy();
    expect(screen.getByText('Passwords do not match')).toBeTruthy();
    const registerCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('register-organization'),
    );
    expect(registerCalls).toHaveLength(0);
  });
});
