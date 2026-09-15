import * as productsRepo from '../db/productsRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser, UserRole } from '../types/auth';

/**
 * BR-27: unpriced products are hidden by default. api-reference.md's literal
 * spelling for this is a query param `?include_unpriced=true&role=owner` —
 * trusting a client-supplied `role` query param for an authorization
 * decision would let anyone see unpriced/cost-adjacent data by just adding
 * that param, which is exactly the kind of thing BR-24 (cost/margin
 * visibility control) exists to prevent. Fixed here: the caller's ROLE
 * comes from their verified JWT (req.user.role), never from the query
 * string — only `include_unpriced` is read from the query.
 */
export function listProducts(includeUnpriced: boolean, requesterRole: UserRole) {
  const canSeeUnpriced = includeUnpriced && requesterRole === 'owner';
  return productsRepo.listProducts(canSeeUnpriced);
}

export function searchSellableProducts(q: string) {
  return productsRepo.searchSellableProducts(q ?? '');
}

// Quantity only — safe for any authenticated role. See stockMovementsRepo's
// getStockLevels() for why this is a separate query from the owner-only
// inventory endpoint rather than just opening that one up.
export function getStockLevels() {
  return stockMovementsRepo.getStockLevels();
}

export async function createProduct(input: {
  name: string;
  categoryId?: number | null;
  unit: string;
  minimumStock?: number;
}) {
  if (!input.name || !input.unit) {
    throw new HttpError(400, 'NAME_AND_UNIT_REQUIRED');
  }
  return productsRepo.createProduct(input);
}

export async function getProductById(id: number) {
  const product = await productsRepo.findProductById(id);
  if (!product) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND');
  }
  return product;
}

/**
 * "Removing" a product never deletes its row — it has purchase history and
 * stock movements referencing it (BR-01: stock is an append-only ledger).
 * Deactivating hides it from the sellable list and the POS search
 * (productsRepo.searchSellableProducts already filters status = 'active');
 * it stays visible to the owner in the full product list and in historical
 * reports/receipts. Mirrors the same active/inactive pattern already used
 * for users and suppliers.
 */
export async function updateProductStatus(id: number, status: string, updatedBy: AuthenticatedUser) {
  if (status !== 'active' && status !== 'inactive') {
    throw new HttpError(400, 'INVALID_STATUS');
  }
  const product = await getProductById(id);
  const updated = await productsRepo.updateProductStatus(product.id, status);

  await writeAuditLog({
    userId: updatedBy.id,
    action: status === 'active' ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED',
    entityType: 'product',
    entityId: id,
    details: { name: product.name, status },
  });

  return updated;
}
