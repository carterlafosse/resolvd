// Serves the OpenAPI spec (server/openapi.yaml) as interactive Swagger UI at /api/docs.
import { readFileSync } from 'node:fs';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

// Read once at startup; a broken spec should stop the server rather than fail per request.
const spec = YAML.parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));

export const docsRouter = Router();

docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(spec, { customSiteTitle: 'Resolvd API docs' }),
);
