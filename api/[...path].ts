// Vercel serverless entry point (classic Node function, not the Services
// beta feature — reverted 2026-09-15 after Vercel Services repeatedly
// failed with "Cannot find module 'express'" in production despite an
// explicit installCommand on the backend service; this classic pattern is
// mature and was already verified end-to-end in this sandbox: booted the
// exported app on a real HTTP server and got 200 from GET /api/v1/health).
//
// Filename [...path].ts makes this a catch-all: every request under /api/*
// (including /api/v1/health, /api/v1/auth/login, etc.) is routed to this
// single function. req.url arrives with the full original path intact,
// which is exactly what createApp() expects since it mounts everything
// under '/api/v1' itself (see backend/src/app.ts).
import { createApp } from '../backend/src/app';

const app = createApp();

export default app;
