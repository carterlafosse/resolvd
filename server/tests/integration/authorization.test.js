// Authorization sweep: every route in the app, called by every role, gets the answer its access rule says.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docsRouter } from '../../src/docs.js';
import { authRouter } from '../../src/modules/auth/auth.routes.js';
import { categoriesRouter } from '../../src/modules/categories/categories.routes.js';
import { commentsRouter } from '../../src/modules/comments/comments.routes.js';
import { healthRouter } from '../../src/modules/health/health.routes.js';
import { slaPoliciesRouter } from '../../src/modules/sla/sla.routes.js';
import { ticketsRouter } from '../../src/modules/tickets/tickets.routes.js';
import { usersRouter } from '../../src/modules/users/users.routes.js';
import {
  app,
  closePools,
  createTicket,
  nextTestIp,
  setUpOrg,
  TEST_PASSWORD,
  ticketBody,
  uniqueEmail,
} from '../helpers.js';

afterAll(closePools);

// ----- Who may call each route -----

const PUBLIC = 'public';
const SIGNED_IN = ['end_user', 'technician', 'admin'];
const STAFF = ['technician', 'admin'];
const ADMIN = ['admin'];
const ROLES = ['end_user', 'technician', 'admin'];

// One row per route. The first test checks this list against the routes the app really has,
// so a new route fails the suite until someone decides who may call it.
const ACCESS = {
  'GET /api/health': PUBLIC,
  'POST /api/auth/register-organization': PUBLIC,
  'POST /api/auth/login': PUBLIC,
  'POST /api/auth/logout': PUBLIC,
  'GET /api/auth/me': SIGNED_IN,
  'GET /api/users': STAFF,
  'POST /api/users': ADMIN,
  'PATCH /api/users/me': SIGNED_IN,
  'PATCH /api/users/:id': ADMIN,
  'GET /api/categories': SIGNED_IN,
  'POST /api/categories': ADMIN,
  'PATCH /api/categories/:id': ADMIN,
  'GET /api/tickets': SIGNED_IN,
  'POST /api/tickets': SIGNED_IN,
  'GET /api/tickets/:id': SIGNED_IN,
  'PATCH /api/tickets/:id': SIGNED_IN,
  'PATCH /api/tickets/:id/status': SIGNED_IN,
  'PATCH /api/tickets/:id/assignment': STAFF,
  'POST /api/tickets/:id/assign-to-me': STAFF,
  'PATCH /api/tickets/:id/priority': STAFF,
  'GET /api/tickets/:id/comments': SIGNED_IN,
  'POST /api/tickets/:id/comments': SIGNED_IN,
  'GET /api/tickets/:id/events': SIGNED_IN,
  'GET /api/tickets/:id/activity': SIGNED_IN,
  'GET /api/sla-policies': STAFF,
  'PUT /api/sla-policies/:priority': ADMIN,
};

// ----- Reading the routes from the app -----

// Where each router is mounted (comments is mounted inside the tickets router). Routers are
// matched by identity: Express doesn't keep the mount path as text.
const MOUNTS = new Map([
  [docsRouter, '/api/docs'],
  [healthRouter, '/api/health'],
  [authRouter, '/api/auth'],
  [usersRouter, '/api/users'],
  [categoriesRouter, '/api/categories'],
  [ticketsRouter, '/api/tickets'],
  [commentsRouter, '/:id/comments'],
  [slaPoliciesRouter, '/api/sla-policies'],
]);

// Walks a router's stack: route layers give "METHOD /path"; a layer whose handler has its own
// stack is a mounted router. Plain middleware (helmet, authenticate, ...) is skipped.
function listRoutes(router, prefix = '') {
  const routes = [];
  for (const layer of router.stack) {
    if (layer.route) {
      const path = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method.toUpperCase()} ${path}`);
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      const mount = MOUNTS.get(layer.handle);
      if (mount === undefined) {
        throw new Error(`A router mounted under ${prefix || 'the app'} is missing from MOUNTS`);
      }
      routes.push(...listRoutes(layer.handle, prefix + mount));
    }
  }
  return routes;
}

// ----- Building a valid request for each route -----

// Valid bodies, so an allowed caller gets past validation and the answer reflects access only.
const BODIES = {
  'POST /api/users': () => ({
    name: 'Sweep User',
    email: uniqueEmail('sweep'),
    role: 'end_user',
    password: TEST_PASSWORD,
  }),
  'PATCH /api/users/me': () => ({ name: 'Swept Name' }),
  'PATCH /api/users/:id': () => ({ department: 'Swept' }),
  'POST /api/categories': () => ({ name: `Sweep ${randomUUID().slice(0, 8)}` }),
  'PATCH /api/categories/:id': () => ({ name: `Swept ${randomUUID().slice(0, 8)}` }),
  'POST /api/tickets': () => ticketBody(),
  'PATCH /api/tickets/:id': () => ({ description: 'Updated during the authorization sweep.' }),
  'PATCH /api/tickets/:id/status': () => ({ status: 'in_progress' }),
  'PATCH /api/tickets/:id/assignment': (ctx) => ({ assigneeId: ctx.techUser.id }),
  'PATCH /api/tickets/:id/priority': () => ({ priority: 'high' }),
  'POST /api/tickets/:id/comments': () => ({ body: 'Comment from the authorization sweep.' }),
  'PUT /api/sla-policies/:priority': () => ({ responseMinutes: 480, resolutionMinutes: 2880 }),
};

// Fills the path's parameters. Ticket routes get a new open ticket from the end user every
// time, so one role's change (say, moving it to in_progress) can't change the next role's answer.
async function urlFor(route, ctx) {
  const path = route.split(' ')[1];
  if (path.startsWith('/api/tickets/:id')) {
    const ticket = await createTicket(ctx.alice);
    return path.replace(':id', ticket.id);
  }
  if (path.startsWith('/api/users/:id')) return path.replace(':id', ctx.bobUser.id);
  if (path.startsWith('/api/categories/:id')) return path.replace(':id', ctx.categoryId('Other'));
  return path.replace(':priority', 'medium');
}

async function call(agent, route, ctx) {
  const method = route.split(' ')[0].toLowerCase();
  const req = agent[method](await urlFor(route, ctx)).set('X-Forwarded-For', nextTestIp());
  const body = BODIES[route]?.(ctx);
  return body === undefined ? req : req.send(body);
}

// ----- Tests -----

const ROUTES = Object.keys(ACCESS);
const PROTECTED = ROUTES.filter((route) => ACCESS[route] !== PUBLIC);

describe('authorization sweep', () => {
  let ctx;
  let agents;
  beforeAll(async () => {
    ctx = await setUpOrg();
    agents = { end_user: ctx.alice, technician: ctx.tech, admin: ctx.admin };
  });

  it('has an access rule for every route the app serves, and no rule for a route it lacks', () => {
    expect(listRoutes(app.router).sort()).toEqual([...ROUTES].sort());
  });

  it.each(ROUTES.filter((route) => ACCESS[route] === PUBLIC))(
    '%s is open without signing in',
    async (route) => {
      // Empty bodies: sign-up and login answer 400, which shows the route let the caller in
      // without creating an organization or using up a login attempt.
      const res = await call(request(app), route, ctx);
      expect([401, 403]).not.toContain(res.status);
      expect(res.status).toBeLessThan(500);
    },
  );

  it.each(PROTECTED)('%s needs a session (401 without one)', async (route) => {
    const res = await call(request(app), route, ctx);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // Every protected route crossed with every role.
  const cases = PROTECTED.flatMap((route) =>
    ROLES.map((role) => [route, role, ACCESS[route].includes(role)]),
  );

  it.each(cases)('%s as %s: allowed = %s', async (route, role, allowed) => {
    const res = await call(agents[role], route, ctx);

    if (allowed) {
      // Allowed callers may still meet a business rule (an end user can't start work on their
      // own ticket: 400), but never a refusal of who they are.
      expect([401, 403, 404]).not.toContain(res.status);
      expect(res.status).toBeLessThan(500);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  // Where visibility applies: an end user allowed on a ticket route still can't reach a
  // ticket someone else requested, and gets 404 so the ticket's existence stays hidden.
  it.each(
    PROTECTED.filter((r) => r.includes('/api/tickets/:id') && ACCESS[r].includes('end_user')),
  )("%s on another end user's ticket is 404", async (route) => {
    const res = await call(ctx.bob, route, ctx);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
