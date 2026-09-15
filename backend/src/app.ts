import express from 'express';
import cors from 'cors';
import routes from './routes/index';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

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

  app.use('/api/v1', routes);

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  return app;
}
