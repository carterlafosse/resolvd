// Categories controllers: read the validated request, call the categories service, send the response.
import * as categoriesService from './categories.service.js';

export async function list(req, res) {
  res.json({ data: await categoriesService.listCategories(req.user) });
}

export async function create(req, res) {
  res.status(201).json(await categoriesService.createCategory(req.user, req.body));
}

export async function rename(req, res) {
  res.json(await categoriesService.renameCategory(req.user, req.params.id, req.body));
}
