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
    const { name, categoryId, unit, minimumStock, startingStock } = req.body ?? {};
    res
      .status(201)
      .json(await productsService.createProduct({ name, categoryId, unit, minimumStock, startingStock, createdBy: req.user! }));
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

// Handles both kinds of PATCH /products/:id has ever sent: the
// Activate/Deactivate toggle (body: { status }) and, since 2026-09-19
// (CLAUDE.md #69, Edit Product), a details edit (body: any of name/unit/
// categoryId/minimumStock). Dispatched by which fields are present rather
// than a second route, since both are genuinely partial updates to the
// same resource.
export async function deleteProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PRODUCT_ID');
    await productsService.deleteProduct(id, req.user!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function updateProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PRODUCT_ID');
    const { status, name, unit, categoryId, minimumStock } = req.body ?? {};
    if (status !== undefined) {
      res.status(200).json(await productsService.updateProductStatus(id, status, req.user!));
      return;
    }
    res.status(200).json(
      await productsService.updateProductDetails(id, { name, unit, categoryId, minimumStock }, req.user!)
    );
  } catch (err) {
    next(err);
  }
}
