import { NextFunction, Request, Response } from 'express';

/**
 * Baseline security headers for a JSON API. Deliberately dependency-free:
 * this project deploys the backend as a Vercel function whose runtime
 * dependencies are listed in the *root* package.json, and adding a package
 * to only backend/package.json has broken production before ("Cannot find
 * module"). These few headers are what `helmet` would set that matter for an
 * API that never serves HTML.
 *
 * `Cache-Control: no-store` matters most here: stock levels, prices and
 * reports must never be served from a browser/proxy cache, and the auth
 * endpoints return tokens.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  next();
}
