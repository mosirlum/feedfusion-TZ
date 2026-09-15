import { Pool } from 'pg';
import { env } from '../config/env';

// Single shared pool for the process. Every query/transaction goes through this.
export const pool = new Pool({
  connectionString: env.databaseUrl,
});

// REQUIRED: without this listener, an 'error' event on an idle client (e.g.
// Neon terminating a connection that's been idle for a while) crashes the
// entire Node process instead of just failing that one query — a
// well-known node-postgres gotcha.
pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client', err);
});