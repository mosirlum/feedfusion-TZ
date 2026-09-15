import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as productsRepo from '../db/productsRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import * as stockAdjustmentsRepo from '../db/stockAdjustmentsRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

/**
 * Stock Adjustments Center redesign (2026-09-12, CLAUDE.md #38): the reason
 * field tightens from unconstrained free text to this fixed set of pills, on
 * the strong precedent of the near-identical Stock Count feature (CLAUDE.md
 * #37's REASONS list) and the reference mockup itself. This is a real
 * behavior change — previously any non-empty string was accepted — flagged
 * rather than silently applied. No migration needed: `reason` stays a plain
 * TEXT column at the DB level, exactly like stock_counts.reason; validation
 * lives here in the service, same pattern as BR-17's non-empty check.
 */
export const VALID_REASONS = ['Damaged', 'Expired', 'Lost', 'Found', 'Correction', 'Other'];

/**
 * Reason lists split by direction (2026-09-13, CLAUDE.md #65) — the owner
 * raised a real business-logic concern: stock is supposed to go up via
 * Purchases (which capture cost/supplier — real traceability) and down via
 * Sales; Adjustments exist only for the exceptions neither of those covers.
 * Before this, any of the 6 reasons was accepted regardless of whether the
 * adjustment was an increase or a decrease — so a positive "Damaged"
 * adjustment (nonsensical; damage never adds units) or, more importantly,
 * routine stock top-ups disguised as "Correction"/"Found" increases were
 * both allowed with no guardrail. Damaged/Expired/Lost only ever make sense
 * as decreases (loss events); Found/Correction are the only legitimate ways
 * an adjustment (as opposed to a Purchase) should increase stock — a
 * physical count turning up more than the ledger expected, or fixing an
 * earlier data-entry mistake. "Other"/"Correction" stay available on both
 * sides since a correction can run either direction. This is validated
 * here (not just filtered in the UI) since the UI alone can't stop a
 * direct API call from sending a mismatched pair.
 */
export const INCREASE_REASONS = ['Found', 'Correction', 'Other'];
export const DECREASE_REASONS = ['Damaged', 'Expired', 'Lost', 'Correction', 'Other'];

/**
 * Section 23: manual stock changes are never allowed directly. This route is
 * owner-only (enforced in routes), so per api-reference.md it's "immediately
 * approved if created by owner" — approved_by = the same owner, recorded for
 * a consistent audit trail rather than left null.
 */
export async function createStockAdjustment(input: {
  productId: number;
  quantity: number;
  reason: string;
  notes?: string;
  createdBy: AuthenticatedUser;
}) {
  if (!input.reason || !input.reason.trim()) {
    throw new HttpError(400, 'REASON_REQUIRED'); // BR-17
  }
  const reason = input.reason.trim();
  if (!VALID_REASONS.includes(reason)) {
    throw new HttpError(400, 'INVALID_REASON', undefined, { validReasons: VALID_REASONS });
  }
  if (input.quantity === 0) {
    throw new HttpError(400, 'QUANTITY_MUST_BE_NONZERO');
  }
  const allowedReasons = input.quantity > 0 ? INCREASE_REASONS : DECREASE_REASONS;
  if (!allowedReasons.includes(reason)) {
    throw new HttpError(400, 'INVALID_REASON_FOR_DIRECTION', undefined, { direction: input.quantity > 0 ? 'increase' : 'decrease', validReasons: allowedReasons });
  }

  return withTransaction(async (client) => {
    const product = await productsRepo.findProductByIdForUpdate(input.productId, client);
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND');

    if (input.quantity < 0) {
      const currentStock = await stockMovementsRepo.getCurrentStock(input.productId, client);
      if (currentStock + input.quantity < 0) {
        throw new HttpError(409, 'ADJUSTMENT_WOULD_MAKE_STOCK_NEGATIVE', undefined, {
          currentStock,
          requestedChange: input.quantity,
        });
      }
    }

    const adjustment = await stockAdjustmentsRepo.insertStockAdjustment(
      {
        productId: input.productId,
        quantity: input.quantity,
        reason,
        notes: input.notes,
        createdBy: input.createdBy.id,
        approvedBy: input.createdBy.id,
      },
      client
    );

    await stockMovementsRepo.insertStockMovement(
      {
        productId: input.productId,
        movementType: 'ADJUSTMENT',
        quantity: input.quantity,
        referenceType: 'stock_adjustment',
        referenceId: adjustment.id,
        createdBy: input.createdBy.id,
      },
      client
    );

    await writeAuditLog(
      {
        userId: input.createdBy.id,
        action: 'STOCK_ADJUSTED',
        entityType: 'product',
        entityId: input.productId,
        details: { adjustmentId: adjustment.id, quantity: input.quantity, reason },
      },
      client
    );

    return adjustment;
  });
}

export function listStockAdjustments() {
  return stockAdjustmentsRepo.listStockAdjustments();
}

export async function getStockAdjustmentsSummary() {
  const c = await stockAdjustmentsRepo.getSummaryCounts();
  const writtenOffHint =
    c.writtenOffLast7 === 0 && c.writtenOffPrior7 === 0
      ? 'No write-offs in the last 7 days'
      : c.writtenOffPrior7 === 0
      ? 'No write-offs in the prior 7 days'
      : `${Math.round(((c.writtenOffLast7 - c.writtenOffPrior7) / c.writtenOffPrior7) * 100)}% vs prior 7 days`;
  return {
    adjustmentsToday: c.adjustmentsToday,
    adjustmentsYesterday: c.adjustmentsYesterday,
    writtenOffLast7: c.writtenOffLast7,
    writtenOffHint,
    increasedLast7: c.increasedLast7,
    decreasedLast7: c.decreasedLast7,
  };
}
