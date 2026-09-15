import { Pool } from 'pg';
import { env } from '../config/env';

// Single shared pool for the process. Every query/transaction goes through this.
export const pool = new Pool({
  connectionString: env.databaseUrl,
});
