import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as productsRepo from '../db/productsRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import * as stockCountsRepo from '../db/stockCountsRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

const VALID_REASONS = ['Damaged', 'Missing', 'Counting correction', 'Other'];

/**
 * expected_qty is computed server-side from the movement ledger at the
 * moment of counting — never taken from the client — so a count can't be
 * gamed by submitting a fabricated "expected" figure.
 */
export async function recordStockCount(input: {
  productId: number;
  physicalQty: number;
  reason: string;
  notes?: string;
  countedBy: AuthenticatedUser;
}) {
  if (!VALID_REASONS.includes(input.reason)) {
    throw new HttpError(400, 'INVALID_REASON');
  }
  if (input.physicalQty < 0) {
    throw new HttpError(400, 'PHYSICAL_QTY_MUST_BE_NON_NEGATIVE');
  }

  return withTransaction(async (client) => {
    const product = await productsRepo.findProductByIdForUpdate(input.productId, client);
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND');

    const expectedQty = await stockMovementsRepo.getCurrentStock(input.productId, client);
    const difference = input.physicalQty - expectedQty;

    const count = await stockCountsRepo.insertStockCount(
      {
        productId: input.productId,
        expectedQty,
        physicalQty: input.physicalQty,
        difference,
        reason: input.reason,
        notes: input.notes?.trim() || null,
        countedBy: input.countedBy.id,
      },
      client
    );

    await writeAuditLog(
      {
        userId: input.countedBy.id,
        action: 'STOCK_COUNT_RECORDED',
        entityType: 'product',
        entityId: input.productId,
        details: { stockCountId: count.id, expectedQty, physicalQty: input.physicalQty, difference },
      },
      client
    );

    return count;
  });
}

/**
 * Section 22/23: approval creates a permanent COUNT_CORRECTION movement —
 * never a silent quantity edit. Owner approval mandatory for MVP.
 */
export async function approveStockCount(id: number, owner: AuthenticatedUser) {
  return withTransaction(async (client) => {
    const count = await stockCountsRepo.findStockCountForUpdate(id, client);
    if (!count) throw new HttpError(404, 'STOCK_COUNT_NOT_FOUND');
    if (count.status !== 'PENDING') throw new HttpError(409, 'STOCK_COUNT_ALREADY_REVIEWED');

    await productsRepo.findProductByIdForUpdate(count.product_id, client);

    if (count.difference !== 0) {
      await stockMovementsRepo.insertStockMovement(
        {
          productId: count.product_id,
          movementType: 'COUNT_CORRECTION',
          quantity: count.difference,
          referenceType: 'stock_count',
          referenceId: count.id,
          createdBy: owner.id,
        },
        client
      );
    }

    const updated = await stockCountsRepo.reviewStockCount(id, 'APPROVED', owner.id, client);
    await writeAuditLog(
      {
        userId: owner.id,
        action: 'STOCK_COUNT_APPROVED',
        entityType: 'product',
        entityId: count.product_id,
        details: { stockCountId: id, difference: count.difference },
      },
      client
    );
    return updated;
  });
}

export async function rejectStockCount(id: number, owner: AuthenticatedUser) {
  return withTransaction(async (client) => {
    const count = await stockCountsRepo.findStockCountForUpdate(id, client);
    if (!count) throw new HttpError(404, 'STOCK_COUNT_NOT_FOUND');
    if (count.status !== 'PENDING') throw new HttpError(409, 'STOCK_COUNT_ALREADY_REVIEWED');

    const updated = await stockCountsRepo.reviewStockCount(id, 'REJECTED', owner.id, client);
    await writeAuditLog(
      { userId: owner.id, action: 'STOCK_COUNT_REJECTED', entityType: 'product', entityId: count.product_id, details: { stockCountId: id } },
      client
    );
    return updated;
  });
}

export function listStockCounts() {
  return stockCountsRepo.listStockCounts();
}

// Stock Count Center redesign (2026-09-12, CLAUDE.md #37) — backs the 3
// stat cards. See stockCountsRepo.getApprovalCounts for what each figure
// means, in particular why "Total Variance" is scoped to PENDING only.
export async function getStockCountSummary() {
  const counts = await stockCountsRepo.getApprovalCounts();
  return {
    pending: Number(counts.pending),
    pendingVarianceUnits: Number(counts.pending_variance),
    countedToday: Number(counts.counted_today),
    countedYesterday: Number(counts.counted_yesterday),
    rejectedToday: Number(counts.rejected_today),
  };
}

interface StockCountActivityEvent {
  id: string;
  action: 'RECORDED' | 'APPROVED' | 'REJECTED';
  productName: string;
  quantity: number;
  actorName: string;
  at: string;
}

// Recent Activity sidebar (same redesign) — each stock_counts row can carry
// up to two real events (when it was submitted, and separately when it was
// resolved), since this table has both a created_at and, since migration
// 013, its own reviewed_at.
export async function getRecentActivity(limit = 8): Promise<StockCountActivityEvent[]> {
  const rows = await stockCountsRepo.listRecentRows(Math.max(limit, 10));
  const events: StockCountActivityEvent[] = [];
  for (const row of rows) {
    events.push({
      id: `${row.id}-recorded`,
      action: 'RECORDED',
      productName: row.product_name,
      quantity: row.physical_qty,
      actorName: row.counted_by_name,
      at: row.created_at,
    });
    if (row.status !== 'PENDING' && row.reviewed_at) {
      events.push({
        id: `${row.id}-reviewed`,
        action: row.status,
        productName: row.product_name,
        quantity: row.physical_qty,
        actorName: row.approved_by_name ?? 'the owner',
        at: row.reviewed_at,
      });
    }
  }
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, limit);
}
