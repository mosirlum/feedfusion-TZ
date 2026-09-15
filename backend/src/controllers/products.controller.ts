import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as productsService from '../services/products.service';

export async function listProductsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const includeUnpriced = req.query.include_unpriced === 'true';
    const role = req.user!.role;
    res.status(200).json(await productsService.listProducts(includeUnpriced, role));
  } catch (err) {
    next(err);
  }
}

export async function searchProductsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.status(200).json(await productsService.searchSellableProducts(q));
  } catch (err) {
    next(err);
  }
}

export async function getStockLevelsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productsService.getStockLevels());
  } catch (err) {
    next(err);
  }
}

export async function createProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, categoryId, unit, minimumStock } = req.body ?? {};
    res.status(201).json(await productsService.createProduct({ name, categoryId, unit, minimumStock }));
  } catch (err) {
    next(err);
  }
}

export async function getProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PRODUCT_ID');
    res.status(200).json(await productsService.getProductById(id));
  } catch (err) {
    next(err);
  }
}

export async function updateProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PRODUCT_ID');
    const { status } = req.body ?? {};
    res.status(200).json(await productsService.updateProductStatus(id, status, req.user!));
  } catch (err) {
    next(err);
  }
}
