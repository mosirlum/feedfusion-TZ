import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, TokenExpiredAuthError, InvalidTokenError } from '../utils/jwt';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MISSING_TOKEN' });
  }
  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    if (err instanceof TokenExpiredAuthError) {
      return res.status(401).json({ error: 'TOKEN_EXPIRED' });
    }
    if (err instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
}
