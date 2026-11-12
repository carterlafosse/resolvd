// SLA policy controllers: read the validated request, call the SLA service, send the response.
import * as slaService from './sla.service.js';

export async function list(req, res) {
  res.json({ data: await slaService.listPolicies(req.user) });
}

export async function update(req, res) {
  res.json(await slaService.updatePolicy(req.user, req.params.priority, req.body));
}
