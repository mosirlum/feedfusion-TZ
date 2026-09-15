import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { resetDatabase, insertTestUser, closePool } from '../testHelpers';

const app = createApp();

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /api/v1/auth/login', () => {
  // Failing scenarios written first, per CLAUDE.md's rule for anything
  // touching auth/stock/sale logic — these must fail red before the
  // happy-path test below is added.

  it('rejects a wrong password', async () => {
    await insertTestUser({ email: 'amani@feedfusion.co.tz', password: 'CorrectHorse1', role: 'owner' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'amani@feedfusion.co.tz', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an inactive user even with the correct password', async () => {
    await insertTestUser({
      email: 'inactive@feedfusion.co.tz',
      password: 'CorrectHorse1',
      role: 'sales',
      status: 'inactive',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@feedfusion.co.tz', password: 'CorrectHorse1' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects a login for an email that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@feedfusion.co.tz', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('logs in successfully with correct credentials and returns access + refresh tokens', async () => {
    await insertTestUser({ email: 'amani@feedfusion.co.tz', password: 'CorrectHorse1', role: 'owner' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'amani@feedfusion.co.tz', password: 'CorrectHorse1' });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.user.email).toBe('amani@feedfusion.co.tz');
    expect(res.body.user.password_hash).toBeUndefined();
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rejects an expired refresh token', async () => {
    const user = await insertTestUser({ email: 'amani@feedfusion.co.tz', password: 'CorrectHorse1', role: 'owner' });
    const expiredToken = jwt.sign({ sub: user.id, role: user.role }, env.jwt.refreshSecret, { expiresIn: -10 });

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: expiredToken });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('rejects a malformed/invalid refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
  });

  it('issues a new access token for a valid refresh token', async () => {
    const user = await insertTestUser({ email: 'amani@feedfusion.co.tz', password: 'CorrectHorse1', role: 'owner' });
    const validToken = jwt.sign({ sub: user.id, role: user.role }, env.jwt.refreshSecret, { expiresIn: '7d' });

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: validToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
  });
});

describe('authenticate middleware (via a protected route)', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('MISSING_TOKEN');
  });

  it('rejects a sales user calling an owner-only route', async () => {
    await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'CorrectHorse1', role: 'sales' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales@feedfusion.co.tz', password: 'CorrectHorse1' });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(res.status).toBe(403);
  });
});
