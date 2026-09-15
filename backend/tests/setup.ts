import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Tests expect a separate *_test database — copy .env.example to ' +
      '.env.test and run `npm run migrate:test` once before `npm test` (see CLAUDE.md Commands).'
  );
}
if (!process.env.DATABASE_URL.includes('test')) {
  // Not a hard failure (naming is a convention, not a guarantee) — but this
  // suite TRUNCATEs tables between every test, so it's worth shouting about
  // a DATABASE_URL that doesn't look like a test database.
  // eslint-disable-next-line no-console
  console.warn(
    `WARNING: DATABASE_URL ("${process.env.DATABASE_URL}") does not contain "test". ` +
      'Tests TRUNCATE tables between runs — make sure this is really your test database.'
  );
}
