// Tickets controllers: read the validated request, call the tickets service, send the response.
import * as ticketsService from './tickets.service.js';

export async function create(req, res) {
  res.status(201).json(await ticketsService.createTicket(req.user, req.body));
}
