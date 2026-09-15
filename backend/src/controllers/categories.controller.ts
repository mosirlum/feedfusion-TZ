import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as categoriesService from '../services/categories.service';

export async function listCategoriesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await categoriesService.listCategories());
  } catch (err) {
    next(err);
  }
}

export async function createCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, parentId } = req.body ?? {};
    if (!name) throw new HttpError(400, 'NAME_REQUIRED');
    res.status(201).json(await categoriesService.createCategory({ name, parentId }));
  } catch (err) {
    next(err);
  }
}
