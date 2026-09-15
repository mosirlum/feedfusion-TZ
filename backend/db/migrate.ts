/**
 * Plain SQL migration runner — no framework DSL, per CLAUDE.md.
 *
 * Applies every *.sql file in db/migrations/, in filename order, that isn't
 * already recorded in schema_migrations. Each file runs in its own
 * transaction: if it fails partway through, that file's changes roll back
 * and the run stops (later files are not attempted).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing required env var: DATABASE_URL');
  }
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations'
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    let ranAny = false;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`apply  ${file}`);
        ranAny = true;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`FAILED ${file}`);
        throw err;
      } finally {
        client.release();
      }
    }

    if (!ranAny) {
      console.log('Nothing to do — schema is up to date.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
