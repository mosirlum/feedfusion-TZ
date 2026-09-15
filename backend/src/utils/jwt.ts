import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { JwtPayload } from '../types/auth';

export class TokenExpiredAuthError extends Error {
  constructor() {
    super('Token expired');
    this.name = 'TokenExpiredAuthError';
  }
}

export class InvalidTokenError extends Error {
  constructor() {
    super('Invalid token');
    this.name = 'InvalidTokenError';
  }
}

export function signAccessToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: env.jwt.accessExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.jwt.accessSecret, options);
}

export function signRefreshToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: env.jwt.refreshExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.jwt.refreshSecret, options);
}

function verify(token: string, secret: string): JwtPayload {
  try {
    return jwt.verify(token, secret) as unknown as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new TokenExpiredAuthError();
    }
    throw new InvalidTokenError();
  }
}

export function verifyAccessToken(token: string): JwtPayload {
  return verify(token, env.jwt.accessSecret);
}

export function verifyRefreshToken(token: string): JwtPayload {
  return verify(token, env.jwt.refreshSecret);
}
