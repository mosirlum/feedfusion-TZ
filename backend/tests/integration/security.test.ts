import request from 'supertest';
import { createApp } from '../../src/app';
import { failureRateLimit } from '../../src/middleware/failureRateLimit';
import express from 'express';
import { resetDatabase, insertTestUser, closePool } from '../testHelpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('API security headers', () => {
  it('sets no-store and anti-sniffing headers and hides the framework', async () => {
    const res = await request(createApp()).get('/api/v1/health');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('login rate limiting', () => {
  it('returns 429 after 8 failed attempts for the same IP+email, and keeps other emails unaffected', async () => {
    await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'CorrectHorse1', role: 'owner' });
    await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'CorrectHorse1', role: 'sales' });
    const app = createApp();

    for (let i = 0; i < 8; i++) {
      const r = await request(app).post('/api/v1/auth/login').send({ email: 'owner@feedfusion.co.tz', password: 'nope' });
      expect(r.status).toBe(401);
    }

    // Even the correct password is refused while locked — otherwise the lock proves nothing.
    const locked = await request(app).post('/api/v1/auth/login').send({ email: 'owner@feedfusion.co.tz', password: 'CorrectHorse1' });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // A different account from the same IP is not locked out.
    const other = await request(app).post('/api/v1/auth/login').send({ email: 'sales@feedfusion.co.tz', password: 'CorrectHorse1' });
    expect(other.status).toBe(200);
  });

  it('a successful login clears earlier failures', async () => {
    await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'CorrectHorse1', role: 'owner' });
    const app = createApp();
    for (let i = 0; i < 7; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'owner@feedfusion.co.tz', password: 'nope' });
    }
    const ok = await request(app).post('/api/v1/auth/login').send({ email: 'owner@feedfusion.co.tz', password: 'CorrectHorse1' });
    expect(ok.status).toBe(200);
    for (let i = 0; i < 7; i++) {
      const r = await request(app).post('/api/v1/auth/login').send({ email: 'owner@feedfusion.co.tz', password: 'nope' });
      expect(r.status).toBe(401); // counter restarted from zero
    }
  });
});

describe('failureRateLimit window', () => {
  it('lets requests through again once the window has passed', async () => {
    let clock = 1_000_000;
    const app = express();
    app.use(express.json());
    app.use(
      '/x',
      failureRateLimit({ windowMs: 1000, maxFailures: 2, keyOf: () => 'k', now: () => clock })
    );
    app.post('/x', (_req, res) => res.status(401).json({ error: 'NO' }));

    expect((await request(app).post('/x')).status).toBe(401);
    expect((await request(app).post('/x')).status).toBe(401);
    expect((await request(app).post('/x')).status).toBe(429);
    clock += 1001;
    expect((await request(app).post('/x')).status).toBe(401);
  });
});
