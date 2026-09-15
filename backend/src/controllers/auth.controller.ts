import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as authService from '../services/auth.service';

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw new HttpError(400, 'EMAIL_AND_PASSWORD_REQUIRED');
    }
    const result = await authService.login(email, password);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      throw new HttpError(400, 'REFRESH_TOKEN_REQUIRED');
    }
    const result = await authService.refresh(refreshToken);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function logoutHandler(_req: Request, res: Response) {
  return res.status(204).send();
}

export async function changePasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      throw new HttpError(400, 'CURRENT_AND_NEW_PASSWORD_REQUIRED');
    }
    const user = await authService.changePassword(req.user!.id, currentPassword, newPassword);
    return res.status(200).json(user);
  } catch (err) {
    return next(err);
  }
}
