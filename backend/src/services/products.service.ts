import * as productsRepo from '../db/productsRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../db/auditRepo';
import { withTransaction } from '../db/transaction';
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

/**
 * Starting stock at creation (2026-09-19, CLAUDE.md #70) — the owner's own
 * words: "tunaweka product then kweny add product tunaweka alert tu kuwa
 * minimum alert isome ngapi but sina pa kuweka iko stock kias gani mpaka
 * kweny adjustment" (we add a product, we can only set the minimum-stock
 * alert, there's nowhere to say how much stock it actually has until Stock
 * Adjustments). This is optional and defaults to 0 (no behavior change for
 * anyone who leaves it blank) — when given, it posts a real stock_movements
 * row rather than a raw column write (CLAUDE.md rule #1), the exact same
 * ADJUSTMENT-typed, no-cost-basis pattern Stock Adjustments' own "Found"
 * reason already uses (CLAUDE.md #38/#65) for stock that has no purchase
 * behind it. Flagged, not silently glossed over: because there's no
 * purchase line for this quantity, `inventoryRepo`'s cost/stock-value
 * figures (which derive unit cost from the most recent purchase) will show
 * no cost for it until a real purchase is recorded for this product — same
 * pre-existing limitation a "Found" adjustment already has, not something
 * new introduced here.
 */
export async function createProduct(input: {
  name: string;
  categoryId?: number | null;
  unit: string;
  minimumStock?: number;
  startingStock?: number;
  createdBy: AuthenticatedUser;
}) {
  if (!input.name || !input.unit) {
    throw new HttpError(400, 'NAME_AND_UNIT_REQUIRED');
  }
  const startingStock = input.startingStock ?? 0;
  if (!Number.isInteger(startingStock) || startingStock < 0) {
    throw new HttpError(400, 'INVALID_STARTING_STOCK');
  }

  // Always in a transaction, and PRODUCT_CREATED is always logged — not
  // just when startingStock > 0. An earlier draft skipped both the
  // transaction and the audit log for the (far more common) zero-starting-
  // stock case, which would have made the Products audit trail only ever
  // show a product creation when the owner happened to key in a starting
  // quantity. Caught before this was pushed; fixed so every product
  // creation gets a consistent audit entry, and the stock movement is
  // simply skipped (not the whole transaction) when there's nothing to post.
  return withTransaction(async (client) => {
    const product = await productsRepo.createProduct(input, client);

    if (startingStock > 0) {
      await stockMovementsRepo.insertStockMovement(
        {
          productId: product.id,
          movementType: 'ADJUSTMENT',
          quantity: startingStock,
          referenceType: 'product_created',
          createdBy: input.createdBy.id,
        },
        client
      );
    }

    await writeAuditLog(
      {
        userId: input.createdBy.id,
        action: 'PRODUCT_CREATED',
        entityType: 'product',
        entityId: product.id,
        details: { name: product.name, unit: product.unit, startingStock },
      },
      client
    );

    return product;
  });
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

/**
 * Edit Product (2026-09-19, CLAUDE.md #69) — added because there was no way
 * for the owner to fix a product's own data after creation (only
 * create + activate/deactivate existed). Root cause of a real complaint:
 * products created with a plain number typed into "Unit" instead of a unit
 * label (e.g. "14" instead of "kg") had no way to be corrected, so the
 * wrong value kept printing on every invoice. Every field is optional —
 * only what's actually sent gets changed (see productsRepo.updateProductDetails).
 */
/**
 * Permanent Delete Product (2026-09-19, CLAUDE.md #69) — the owner asked
 * for a real delete (not just Deactivate) "with a warning to make sure
 * it's not deleted by accident." The warning itself lives in the frontend
 * confirmation modal; this mirrors the exact pattern already used for
 * deleting a user (users.service.ts's deleteUser/isForeignKeyViolation):
 * attempt the delete, and if Postgres rejects it with a foreign-key
 * violation (23503) — meaning this product has ever been sold, purchased,
 * counted, adjusted, proposed a price for, or quoted — translate that into
 * a clear message rather than a raw database error. Only a product with
 * zero references anywhere (created by mistake, never actually used) can
 * be deleted this way; everything else stays on Deactivate, unchanged.
 */
export async function deleteProduct(id: number, deletedBy: AuthenticatedUser) {
  const product = await getProductById(id);

  try {
    // A product whose only recorded activity is its own starting-stock
    // movement from creation (CLAUDE.md #70) is still safe to hard-delete —
    // see productsRepo.hasOnlyStartingStockActivity for why. Anything else
    // (a sale, purchase, later adjustment, price proposal, quotation line,
    // stock count) falls through to the plain delete below, which still
    // hits the real foreign-key violation and the same friendly message.
    const onlyStartingStock = await productsRepo.hasOnlyStartingStockActivity(id);
    if (onlyStartingStock) {
      await withTransaction((client) => productsRepo.deleteProductCleaningStartingStock(id, client));
    } else {
      await productsRepo.deleteProduct(id);
    }
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw new HttpError(
        409,
        'PRODUCT_HAS_HISTORY',
        'This product has recorded activity in the system (sales, purchases, stock records, etc.) and cannot be deleted. Deactivate it instead.'
      );
    }
    throw err;
  }

  await writeAuditLog({
    userId: deletedBy.id,
    action: 'PRODUCT_DELETED',
    entityType: 'product',
    entityId: id,
    details: { name: product.name, unit: product.unit },
  });
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

export async function updateProductDetails(
  id: number,
  patch: { name?: string; categoryId?: number | null; unit?: string; minimumStock?: number },
  updatedBy: AuthenticatedUser
) {
  const product = await getProductById(id);

  if (patch.name !== undefined && !patch.name.trim()) {
    throw new HttpError(400, 'NAME_REQUIRED');
  }
  if (patch.unit !== undefined && !patch.unit.trim()) {
    throw new HttpError(400, 'UNIT_REQUIRED');
  }
  if (patch.minimumStock !== undefined && (!Number.isFinite(patch.minimumStock) || patch.minimumStock < 0)) {
    throw new HttpError(400, 'INVALID_MINIMUM_STOCK');
  }

  const updated = await productsRepo.updateProductDetails(id, patch);

  await writeAuditLog({
    userId: updatedBy.id,
    action: 'PRODUCT_UPDATED',
    entityType: 'product',
    entityId: id,
    details: {
      before: { name: product.name, unit: product.unit, categoryId: product.category_id, minimumStock: product.minimum_stock },
      after: patch,
    },
  });

  return updated;
}
