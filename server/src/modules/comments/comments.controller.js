// Comments controllers: read the validated request, call the comments service, send the response.
import * as commentsService from './comments.service.js';

export async function list(req, res) {
  res.json(await commentsService.listComments(req.user, req.params.id));
}

export async function create(req, res) {
  res.status(201).json(await commentsService.addComment(req.user, req.params.id, req.body));
}
