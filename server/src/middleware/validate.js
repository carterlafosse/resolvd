// validate({ body, query, params }): parses request parts with Zod schemas before the controller runs.
//
// Parsed values replace the raw ones, so controllers only ever see validated, typed input.
// Zod object schemas drop keys they don't list, which blocks mass assignment (for example a
// client sending "role": "admin" to an endpoint that doesn't accept it).
// A failed parse throws a ZodError, which the error handler turns into 400 VALIDATION_ERROR.
export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    if (params) req.params = params.parse(req.params);
    // Express 5 makes req.query a read-only getter, so the parsed query goes on its own property.
    if (query) req.validatedQuery = query.parse(req.query);
    if (body) req.body = body.parse(req.body);
    next();
  };
}
