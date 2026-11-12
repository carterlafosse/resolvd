// GET /api/health: reports whether the API is up and can reach the database (used by Render).
import { Router } from 'express';
import { pool } from '../../db/pool.js';

export const healthRouter = Router();

// No tenant data is read, so pool.query (no withOrg) is correct here.
healthRouter.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'up' });
  } catch (err) {
    req.log.warn({ err }, 'Health check: database unreachable');
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});
