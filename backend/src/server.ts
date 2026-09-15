import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';

const app = createApp();

app.listen(env.port, () => {
  console.log(`Feed Fusion Tanzania backend listening on port ${env.port}`);
});

// Neon's serverless Postgres suspends its compute after a period with no
// queries; the next query then has to "wake" it, which can take several
// seconds. A request submitted right at that moment (e.g. recording a
// purchase) can appear to fail on the client — a lost/very slow response —
// even though it goes on to commit successfully on the server, which is
// exactly what the owner reported (2026-09-11): an error toast, then the
// purchase already there after a refresh. A small periodic no-op query
// keeps the compute awake during active hours so a real request practically
// never pays that wake-up cost. Failures here are swallowed on purpose —
// a missed keep-alive just means the next real query pays the cost, same
// as before this existed.
setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 4 * 60 * 1000);
