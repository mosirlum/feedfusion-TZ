import { HttpError } from '../middleware/errorHandler';
import { findUserByEmail, findUserById, updateOwnPassword } from '../db/usersRepo';
import { comparePassword, hashPassword } from '../utils/password';
import { writeAuditLog } from '../db/auditRepo';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  TokenExpiredAuthError,
  InvalidTokenError,
} from '../utils/jwt';
import { PublicUser, toPublicUser } from '../types/auth';

const MIN_PASSWORD_LENGTH = 6;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await findUserByEmail(email);
  if (!user) {
    throw new HttpError(401, 'INVALID_CREDENTIALS');
  }

  const passwordOk = await comparePassword(password, user.password_hash);
  if (!passwordOk) {
    throw new HttpError(401, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_INACTIVE');
  }

  const payload = { sub: user.id, role: user.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    user: toPublicUser(user),
  };
}

export interface RefreshResult {
  accessToken: string;
}

export async function refresh(refreshToken: string): Promise<RefreshResult> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    if (err instanceof TokenExpiredAuthError) {
      throw new HttpError(401, 'REFRESH_TOKEN_EXPIRED');
    }
    if (err instanceof InvalidTokenError) {
      throw new HttpError(401, 'INVALID_REFRESH_TOKEN');
    }
    throw err;
  }

  const user = await findUserById(payload.sub);
  if (!user || user.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_INACTIVE');
  }

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
  };
}

/**
 * A person setting their OWN new password (2026-09-12, CLAUDE.md #47) — used
 * both for the forced change (must_change_password: after a fresh account or
 * an owner reset) and a voluntary change from My Profile. Always requires
 * the current password, even in the forced case — they just used it to log
 * in, so this doesn't add friction, and it keeps a stolen access token alone
 * from being enough to lock the real owner of the account out.
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<PublicUser> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, 'PASSWORD_TOO_SHORT');
  }
  const user = await findUserById(userId);
  if (!user) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  const currentOk = await comparePassword(currentPassword, user.password_hash);
  if (!currentOk) {
    throw new HttpError(401, 'CURRENT_PASSWORD_INCORRECT');
  }
  const passwordHash = await hashPassword(newPassword);
  const updated = await updateOwnPassword(userId, passwordHash);
  if (!updated) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  await writeAuditLog({ userId, action: 'USER_PASSWORD_CHANGED', entityType: 'user', entityId: userId });
  return toPublicUser(updated);
}
