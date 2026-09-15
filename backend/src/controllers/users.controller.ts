import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as usersService from '../services/users.service';
import { UserRole, UserStatus } from '../types/auth';
import { isValidTzPhone } from '../utils/phone';

const VALID_ROLES: UserRole[] = ['owner', 'sales', 'manager'];
const VALID_STATUSES: UserStatus[] = ['active', 'inactive'];

export async function listUsersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await usersService.listUsers();
    return res.status(200).json(users);
  } catch (err) {
    return next(err);
  }
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, phone, password, role } = req.body ?? {};
    if (!name || !email || !password || !role) {
      throw new HttpError(400, 'NAME_EMAIL_PASSWORD_ROLE_REQUIRED');
    }
    if (!VALID_ROLES.includes(role)) {
      throw new HttpError(400, 'INVALID_ROLE');
    }
    if (phone && !isValidTzPhone(phone)) {
      throw new HttpError(400, 'INVALID_PHONE_FORMAT');
    }
    const user = await usersService.createUser({ name, email, phone, password, role });
    return res.status(201).json(user);
  } catch (err) {
    return next(err);
  }
}

export async function updateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new HttpError(400, 'INVALID_USER_ID');
    }
    const { status, role } = req.body ?? {};
    if (status === undefined && role === undefined) {
      throw new HttpError(400, 'NOTHING_TO_UPDATE');
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw new HttpError(400, 'INVALID_STATUS');
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      throw new HttpError(400, 'INVALID_ROLE');
    }
    const user = await usersService.updateUser(id, { status, role });
    return res.status(200).json(user);
  } catch (err) {
    return next(err);
  }
}

export async function deleteUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new HttpError(400, 'INVALID_USER_ID');
    }
    await usersService.deleteUser(id, req.user!.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new HttpError(400, 'INVALID_USER_ID');
    }
    const { newPassword } = req.body ?? {};
    if (!newPassword) {
      throw new HttpError(400, 'NEW_PASSWORD_REQUIRED');
    }
    const user = await usersService.resetPassword(id, newPassword, req.user!.id);
    return res.status(200).json(user);
  } catch (err) {
    return next(err);
  }
}

export async function updateOwnProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, email, avatarDataUrl } = req.body ?? {};
    const user = await usersService.updateOwnProfile(req.user!.id, { name, phone, email, avatarDataUrl });
    return res.status(200).json(user);
  } catch (err) {
    return next(err);
  }
}
