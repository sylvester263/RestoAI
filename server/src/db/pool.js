import pg from 'pg';
import config from '../config.js';

const pool = new pg.Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err);
});

/**
 * Run a query with optional tenant scoping.
 * @param {string} text - SQL query
 * @param {any[]} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (config.nodeEnv === 'development') {
    console.log(`[db] ${text.trim().slice(0, 60)}… (${duration}ms, ${result.rowCount} rows)`);
  }
  return result;
}

/**
 * Run a series of queries inside a transaction, passing a client whose
 * .query() participates in it. Commits on success, rolls back on throw.
 * @param {(client: pg.PoolClient) => Promise<any>} fn
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
