// Tickets controllers: read the validated request, call the tickets service, send the response.
import * as ticketsService from './tickets.service.js';

export async function list(req, res) {
  res.json(await ticketsService.listTickets(req.user, req.validatedQuery));
}

export async function create(req, res) {
  res.status(201).json(await ticketsService.createTicket(req.user, req.body));
}

export async function get(req, res) {
  res.json(await ticketsService.getTicket(req.user, req.params.id));
}

export async function update(req, res) {
  res.json(await ticketsService.updateTicket(req.user, req.params.id, req.body));
}

export async function changeStatus(req, res) {
  res.json(await ticketsService.changeStatus(req.user, req.params.id, req.body));
}

export async function assign(req, res) {
  res.json(await ticketsService.assignTicket(req.user, req.params.id, req.body.assigneeId));
}

export async function assignToMe(req, res) {
  res.json(await ticketsService.assignTicket(req.user, req.params.id, req.user.id));
}

export async function changePriority(req, res) {
  res.json(await ticketsService.changePriority(req.user, req.params.id, req.body));
}
