import express from 'express';
import cors from 'cors';
import routes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';
import { clientIp, failureRateLimit } from './middleware/failureRateLimit';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  // Default express.json() limit is 100kb — fine for ordinary requests, but
  // a purchase's attached invoice/quotation photo (CLAUDE.md #68) is a
  // base64 data: URL that alone can run several hundred KB even after
  // client-side resizing, since it needs to stay legible enough to read
  // real numbers off later (unlike the small 256px avatar photo). Raised
  // to 3mb so that request isn't silently rejected as too large; the
  // frontend still resizes/compresses before sending, this just gives it
  // headroom.
  app.use(express.json({ limit: '3mb' }));

  // Slow down password guessing: after 8 failed logins for the same
  // IP + email within 15 minutes, further attempts get 429 until the window
  // passes. Created per app instance so tests start with a clean slate.
  app.use(
    '/api/v1/auth/login',
    failureRateLimit({
      windowMs: 15 * 60 * 1000,
      maxFailures: 8,
      keyOf: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email ? `${clientIp(req)}|${email}` : null;
      },
    })
  );

  app.use('/api/v1', routes);

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  return app;
}
