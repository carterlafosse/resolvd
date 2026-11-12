// Transaction helpers: the org setting is scoped to one transaction and errors roll back cleanly.
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { withOrg, withTransaction } from '../../src/db/withOrg.js';

afterAll(() => pool.end());

const readOrgSetting = async (client) =>
  (await client.query("SELECT current_setting('app.current_org_id', true) AS org")).rows[0].org;

describe('withOrg', () => {
  it('sets app.current_org_id inside the transaction', async () => {
    expect(await withOrg(42, readOrgSetting)).toBe('42');
  });

  it('does not leak the setting to the connection afterwards', async () => {
    // Hold the only connection so the next query is guaranteed to reuse it.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', '7', true)");
      await client.query('COMMIT');

      expect(await readOrgSetting(client)).toBeFalsy();
    } finally {
      client.release();
    }
  });
});

describe('withTransaction', () => {
  it('rethrows errors from work and releases the client', async () => {
    const before = pool.totalCount - pool.idleCount;

    await expect(
      withTransaction(async () => {
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');

    expect(pool.totalCount - pool.idleCount).toBe(before);
  });

  it('rolls back changes when work fails', async () => {
    // A session-level setting changed with is_local=false survives COMMIT but not ROLLBACK.
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.rollback_probe', 'before', false)");
    } finally {
      client.release();
    }

    await expect(
      withTransaction(async (c) => {
        await c.query("SELECT set_config('app.rollback_probe', 'during', false)");
        throw new Error('undo');
      }),
    ).rejects.toThrow('undo');

    // Tests run sequentially, so the pool has only ever needed one connection and this
    // query reads the same session the probe was set on.
    expect(pool.totalCount).toBe(1);
    const { rows } = await pool.query("SELECT current_setting('app.rollback_probe', true) AS v");
    expect(rows[0].v).toBe('before');
  });
});
