// Auth controllers: read the validated request, call the auth service, send the response.
import * as authService from './auth.service.js';
import { setSessionCookie } from './session.js';

export async function registerOrganization(req, res) {
  const result = await authService.registerOrganization(req.body);
  setSessionCookie(res, result.user);
  res.status(201).json(result);
}

export async function login(req, res) {
  const result = await authService.login(req.body);
  setSessionCookie(res, result.user);
  res.json(result);
}
