import { pool } from './pool';
import { UserRecord, UserRole, UserStatus } from '../types/auth';

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<UserRecord[]> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users ORDER BY created_at ASC');
  return rows;
}

/**
 * Every new account is created with must_change_password = true (2026-09-12,
 * CLAUDE.md #47) — the password just hashed here is always one the owner
 * typed as a "temporary password" on the New User form, never one the new
 * person chose themselves.
 */
export async function createUser(input: {
  name: string;
  email: string;
  phone?: string | null;
  passwordHash: string;
  role: UserRole;
}): Promise<UserRecord> {
  const { rows } = await pool.query<UserRecord>(
    `INSERT INTO users (name, email, phone, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`,
    [input.name, input.email, input.phone ?? null, input.passwordHash, input.role]
  );
  return rows[0];
}

/**
 * Updates only status and/or role. api-reference.md also lists
 * `max_discount_pct` here, but decisions-log.md #4 settled the discount
 * limit as ONE global value in business_settings, not per-user — there's no
 * per-user column for it. That part of the doc is stale; intentionally not
 * implemented, flagged in the delivery notes.
 */
export async function updateUser(
  id: number,
  input: { status?: UserStatus; role?: UserRole }
): Promise<UserRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.status !== undefined) {
    values.push(input.status);
    sets.push(`status = $${values.length}`);
  }
  if (input.role !== undefined) {
    values.push(input.role);
    sets.push(`role = $${values.length}`);
  }
  if (sets.length === 0) {
    return findUserById(id);
  }

  values.push(id);
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

/**
 * Hard-deletes a user row. Deliberately does NOT pre-check every table that
 * references users(id) (products.price_last_changed_by, purchases.created_by,
 * sales.served_by, audit_logs.user_id, and half a dozen others) — that list
 * would drift the moment a future migration adds one more. Instead this lets
 * Postgres's own foreign-key constraints do the checking: if the user has any
 * recorded activity, the DELETE itself fails with a 23503 foreign_key_violation,
 * which usersService.deleteUser translates into a clear USER_HAS_RELATED_RECORDS
 * error. Only ever succeeds for an account that's never actually done anything
 * in the system (2026-09-12, CLAUDE.md #45).
 */
export async function deleteUser(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Owner-initiated reset (2026-09-12, CLAUDE.md #47) — sets a new temporary
 * password the owner typed themselves and forces a real change on next
 * login, same as a brand-new account.
 */
export async function resetPassword(id: number, passwordHash: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2 RETURNING *`,
    [passwordHash, id]
  );
  return rows[0] ?? null;
}

/**
 * A person setting their OWN password — whether that's the forced
 * first-login/post-reset change, or a voluntary change from My Profile.
 * Always clears must_change_password, since either way it's now a password
 * only they know.
 */
export async function updateOwnPassword(id: number, passwordHash: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2 RETURNING *`,
    [passwordHash, id]
  );
  return rows[0] ?? null;
}

/**
 * Self-service profile update (2026-09-12, CLAUDE.md #47) — name, phone,
 * email and/or avatar. Role and status stay owner-only, via the existing
 * updateUser above; this never touches those columns even if somehow asked
 * to, since the service layer only ever passes the fields it explicitly
 * validated for a self-update.
 */
export async function updateOwnProfile(
  id: number,
  input: { name?: string; phone?: string | null; email?: string; avatarDataUrl?: string | null }
): Promise<UserRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    sets.push(`name = $${values.length}`);
  }
  if (input.phone !== undefined) {
    values.push(input.phone);
    sets.push(`phone = $${values.length}`);
  }
  if (input.email !== undefined) {
    values.push(input.email);
    sets.push(`email = $${values.length}`);
  }
  if (input.avatarDataUrl !== undefined) {
    values.push(input.avatarDataUrl);
    sets.push(`avatar_data_url = $${values.length}`);
  }
  if (sets.length === 0) {
    return findUserById(id);
  }

  values.push(id);
  const { rows } = await pool.query<UserRecord>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}
