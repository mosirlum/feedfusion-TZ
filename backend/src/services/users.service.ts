import { HttpError } from '../middleware/errorHandler';
import * as usersRepo from '../db/usersRepo';
import { hashPassword } from '../utils/password';
import { writeAuditLog } from '../db/auditRepo';
import { PublicUser, toPublicUser, UserRole, UserStatus } from '../types/auth';

const MIN_PASSWORD_LENGTH = 6; // matches the New User form's existing minLength={6}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await usersRepo.listUsers();
  return users.map(toPublicUser);
}

export async function createUser(input: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
}): Promise<PublicUser> {
  const existing = await usersRepo.findUserByEmail(input.email);
  if (existing) {
    throw new HttpError(409, 'EMAIL_ALREADY_IN_USE');
  }

  const passwordHash = await hashPassword(input.password);
  const created = await usersRepo.createUser({
    name: input.name,
    email: input.email,
    phone: input.phone,
    passwordHash,
    role: input.role,
  });
  return toPublicUser(created);
}

export async function updateUser(
  id: number,
  input: { status?: UserStatus; role?: UserRole }
): Promise<PublicUser> {
  const updated = await usersRepo.updateUser(id, input);
  if (!updated) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  return toPublicUser(updated);
}

export async function deleteUser(id: number, requestingUserId: number): Promise<void> {
  if (id === requestingUserId) {
    throw new HttpError(400, 'CANNOT_DELETE_SELF');
  }
  const existing = await usersRepo.findUserById(id);
  if (!existing) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  try {
    await usersRepo.deleteUser(id);
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw new HttpError(
        409,
        'USER_HAS_RELATED_RECORDS',
        'This user has recorded activity in the system (sales, purchases, stock records, audit history, etc.) and cannot be deleted. Deactivate the account instead.'
      );
    }
    throw err;
  }
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

/**
 * Owner-initiated reset (2026-09-12, CLAUDE.md #47) — for a sales/manager
 * user who forgot their password. The owner types a new temporary one
 * (same UX as creating an account); it forces a real change on that
 * person's next login, same as a brand-new account.
 */
export async function resetPassword(id: number, newPassword: string, resetBy: number): Promise<PublicUser> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, 'PASSWORD_TOO_SHORT');
  }
  const existing = await usersRepo.findUserById(id);
  if (!existing) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  const passwordHash = await hashPassword(newPassword);
  const updated = await usersRepo.resetPassword(id, passwordHash);
  if (!updated) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  await writeAuditLog({
    userId: resetBy,
    action: 'USER_PASSWORD_RESET',
    entityType: 'user',
    entityId: id,
    details: { targetUserName: existing.name },
  });
  return toPublicUser(updated);
}

/**
 * Self-service profile update (2026-09-12, CLAUDE.md #47) — name, phone,
 * email, and/or avatar photo, whichever fields are actually passed. Role and
 * status are never accepted here — those stay owner-only via updateUser
 * above, reached only from the Users page.
 */
export async function updateOwnProfile(
  id: number,
  input: { name?: string; phone?: string | null; email?: string; avatarDataUrl?: string | null }
): Promise<PublicUser> {
  if (input.name !== undefined && !input.name.trim()) {
    throw new HttpError(400, 'NAME_REQUIRED');
  }
  if (input.email !== undefined) {
    if (!input.email.trim()) {
      throw new HttpError(400, 'EMAIL_REQUIRED');
    }
    const existing = await usersRepo.findUserByEmail(input.email.trim());
    if (existing && existing.id !== id) {
      throw new HttpError(409, 'EMAIL_ALREADY_IN_USE');
    }
  }

  const updated = await usersRepo.updateOwnProfile(id, {
    name: input.name?.trim(),
    phone: input.phone !== undefined ? input.phone?.trim() || null : undefined,
    email: input.email?.trim(),
    avatarDataUrl: input.avatarDataUrl,
  });
  if (!updated) {
    throw new HttpError(404, 'USER_NOT_FOUND');
  }
  await writeAuditLog({
    userId: id,
    action: 'USER_PROFILE_UPDATED',
    entityType: 'user',
    entityId: id,
    details: { fields: Object.keys(input) },
  });
  return toPublicUser(updated);
}
