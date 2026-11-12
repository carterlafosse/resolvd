// Users controllers: read the validated request, call the users service, send the response.
import * as usersService from './users.service.js';

export async function list(req, res) {
  res.json({ data: await usersService.listUsers(req.user, req.validatedQuery) });
}

export async function create(req, res) {
  res.status(201).json(await usersService.createUser(req.user, req.body));
}

export async function update(req, res) {
  res.json(await usersService.updateUser(req.user, req.params.id, req.body));
}

export async function updateMe(req, res) {
  res.json(await usersService.updateMe(req.user, req.body));
}
