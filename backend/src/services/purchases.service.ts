import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as purchasesRepo from '../db/purchasesRepo';
import * as suppliersRepo from '../db/suppliersRepo';
import * as productsRepo from '../db/productsRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import * as purchaseEditRequestsRepo from '../db/purchaseEditRequestsRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

export interface PurchaseItemInput {
  productId: number;
  quantity: number;
  unitCost: number;
}

/**
 * Section 10 (Cost Calculation): additional costs (e.g. transport) are
 * allocated into stock cost so profit doesn't lie. The spec's worked example
 * covers a single line item; with multiple lines, this allocates
 * proportionally by each line's pre-additional-cost subtotal share of the
 * purchase — a reasonable, standard method, but the docs don't spell it out
 * for the multi-line case, so it's flagged as a judgment call.
 */
function allocateCosts<T extends { unitCost: number; quantity: number }>(items: T[], additionalCosts: number) {
  const subtotals = items.map((item) => item.unitCost * item.quantity);
  const totalSubtotal = subtotals.reduce((sum, s) => sum + s, 0);

  return items.map((item, i) => {
    const subtotal = subtotals[i];
    const allocatedAdditionalCost =
      totalSubtotal > 0 ? additionalCosts * (subtotal / totalSubtotal) : additionalCosts / items.length;
    return {
      ...item,
      subtotal,
      allocatedAdditionalCost,
      totalCost: subtotal + allocatedAdditionalCost,
    };
  });
}

export interface AdditionalCostLineInput {
  label: string;
  amount: number;
}

/** Postgres unique-violation is error code 23505; `column` narrows it to the specific constraint we're guarding against. */
function isUniqueViolation(err: unknown, column: string): boolean {
  const pgErr = err as { code?: string; constraint?: string; detail?: string } | null;
  return !!pgErr && pgErr.code === '23505' && (pgErr.constraint?.includes(column) || pgErr.detail?.includes(column)) === true;
}

/**
 * Simple sequential reference number — "PO-2026-0001", "PO-2026-0002", ...
 * restarting at 0001 each calendar year, per the owner's request (2026-09-11)
 * for something short and readable instead of the earlier timestamp-based
 * generator. Counts existing purchases for the year rather than keeping a
 * separate counter table — good enough for a single shop; a genuine
 * duplicate (e.g. a very rare race between two submissions) is still caught
 * as a unique-violation below and surfaced as a clear, retryable error.
 */
async function nextReferenceNumber(queryable: PoolClient | typeof pool): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await queryable.query('SELECT COUNT(*)::int AS count FROM purchases WHERE reference_number LIKE $1', [
    `PO-${year}-%`,
  ]);
  const next = rows[0].count + 1;
  return `PO-${year}-${String(next).padStart(4, '0')}`;
}

/** For the frontend to show what the reference number will look like before the owner submits — not reserved, so it can shift if another purchase is recorded first. */
export async function previewNextReferenceNumber(): Promise<string> {
  return nextReferenceNumber(pool);
}

export async function createPurchase(input: {
  supplierId: number;
  referenceNumber?: string;
  purchaseDate?: string;
  additionalCosts?: number;
  additionalCostLines?: AdditionalCostLineInput[];
  notes?: string;
  // One photo of the supplier's invoice/quotation (CLAUDE.md #68) — a
  // base64 data: URL, same storage pattern as the user avatar photo.
  // Optional: purchases recorded without a physical document still work.
  documentDataUrl?: string | null;
  items: PurchaseItemInput[];
  createdBy: AuthenticatedUser;
}) {
  if (!input.items || input.items.length === 0) {
    throw new HttpError(400, 'AT_LEAST_ONE_ITEM_REQUIRED');
  }
  for (const item of input.items) {
    if (item.quantity <= 0) throw new HttpError(400, 'QUANTITY_MUST_BE_POSITIVE');
    if (item.unitCost < 0) throw new HttpError(400, 'UNIT_COST_MUST_BE_NON_NEGATIVE');
  }

  // Itemized cost lines (migration 010 — e.g. "Labour charge", "Delivery
  // cost") are the source of truth for the total when provided: the total
  // IS the sum of its parts, never entered twice. `additionalCosts` alone
  // still works for callers that don't itemize (e.g. this project's own
  // seed script may pass either).
  const costLines = (input.additionalCostLines ?? []).filter((l) => l.label && l.label.trim() && l.amount > 0);
  for (const line of costLines) {
    if (line.amount < 0) throw new HttpError(400, 'COST_LINE_AMOUNT_MUST_BE_NON_NEGATIVE');
  }
  const additionalCosts = costLines.length > 0 ? costLines.reduce((sum, l) => sum + l.amount, 0) : input.additionalCosts ?? 0;

  return withTransaction(async (client) => {
    const supplier = await suppliersRepo.findSupplierById(input.supplierId);
    if (!supplier) {
      throw new HttpError(404, 'SUPPLIER_NOT_FOUND');
    }

    const allocated = allocateCosts(input.items, additionalCosts);
    const totalCost = allocated.reduce((sum, item) => sum + item.totalCost, 0);
    const referenceNumber = input.referenceNumber?.trim() || (await nextReferenceNumber(client));

    let purchase;
    try {
      purchase = await purchasesRepo.insertPurchase(
        {
          supplierId: input.supplierId,
          referenceNumber,
          purchaseDate: input.purchaseDate,
          additionalCosts,
          totalCost,
          notes: input.notes,
          documentDataUrl: input.documentDataUrl,
          createdBy: input.createdBy.id,
        },
        client
      );
    } catch (err) {
      // reference_number is UNIQUE — a manually-typed reference could collide
      // with an existing one, or (very rarely) two blank submissions could
      // race for the same sequential number. Surface this as a clear,
      // recoverable error instead of a raw DB error reaching the client as
      // "internal error".
      if (isUniqueViolation(err, 'reference_number')) {
        throw new HttpError(409, 'REFERENCE_NUMBER_ALREADY_EXISTS');
      }
      throw err;
    }

    for (const item of allocated) {
      await purchasesRepo.insertPurchaseItem(
        {
          purchaseId: purchase.id,
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          allocatedAdditionalCost: item.allocatedAdditionalCost,
          totalCost: item.totalCost,
        },
        client
      );
      await stockMovementsRepo.insertStockMovement(
        {
          productId: item.productId,
          movementType: 'PURCHASE',
          quantity: item.quantity,
          referenceType: 'purchase',
          referenceId: purchase.id,
          createdBy: input.createdBy.id,
        },
        client
      );
    }

    for (const line of costLines) {
      await purchasesRepo.insertAdditionalCostLine(
        { purchaseId: purchase.id, label: line.label.trim(), amount: line.amount },
        client
      );
    }

    await writeAuditLog(
      {
        userId: input.createdBy.id,
        action: 'PURCHASE_RECORDED',
        entityType: 'purchase',
        entityId: purchase.id,
        details: { referenceNumber, totalCost, itemCount: input.items.length },
      },
      client
    );

    // Must read through `client` (this transaction's own connection), not
    // the shared pool — the insert above hasn't committed yet, so a
    // different connection can't see it (see the comment on
    // findPurchaseById in purchasesRepo.ts).
    return purchasesRepo.findPurchaseById(purchase.id, client);
  });
}

export async function getPurchaseById(id: number) {
  const purchase = await purchasesRepo.findPurchaseById(id);
  if (!purchase) {
    throw new HttpError(404, 'PURCHASE_NOT_FOUND');
  }
  return purchase;
}

export function listPurchases() {
  return purchasesRepo.listPurchases();
}

// ---------------------------------------------------------------------------
// Purchase edit requests (2026-09-11) — correcting a mistake on an
// already-recorded purchase. Confirmed with the owner: sales staff now get
// access to record purchases too, but any edit THEY make must wait for the
// owner's approval with a reason attached; the owner's own edits apply
// immediately — the exact same "owner auto-approves, sales user sits
// PENDING" shape already used for price proposals (BR-26/BR-29). Only "the
// numbers" are editable this way: an existing item's quantity/unit cost, or
// an existing expense line's amount — never the supplier, date, reference
// number, or which lines exist (no adding/removing items or cost lines,
// no changing which product a line is for). See CLAUDE.md for the full
// design writeup and the judgment calls made while building this.
// ---------------------------------------------------------------------------

export interface EditItemPatchInput {
  purchaseItemId: number;
  quantity: number;
  unitCost: number;
}

export interface EditCostLinePatchInput {
  costLineId: number;
  amount: number;
}

/**
 * Applies an already-decided edit (the owner's own immediate edit, or one
 * the owner just approved) to the real purchase_items/cost-line rows, then
 * posts a compensating stock_movements ADJUSTMENT for any quantity delta —
 * stock is never edited directly (CLAUDE.md rule #1), so a correction is
 * one more ledger entry, not a rewrite of history. Every item/cost-line row
 * on the purchase is locked (FOR UPDATE) first so a second edit request on
 * the same purchase can't be approved concurrently and clobber this one's
 * recalculated allocation.
 */
async function applyPurchaseEdit(
  purchaseId: number,
  items: EditItemPatchInput[],
  costLines: EditCostLinePatchInput[],
  actingUserId: number,
  client: PoolClient
) {
  const currentItems = await purchasesRepo.getPurchaseItemsForUpdate(purchaseId, client);
  const currentCostLines = await purchasesRepo.getAdditionalCostLinesForUpdate(purchaseId, client);

  const itemPatchMap = new Map(items.map((i) => [i.purchaseItemId, i]));
  const costLinePatchMap = new Map(costLines.map((c) => [c.costLineId, c.amount]));

  const newAdditionalCosts = currentCostLines.reduce(
    (sum: number, cl: { id: number; amount: string | number }) =>
      sum + (costLinePatchMap.has(cl.id) ? costLinePatchMap.get(cl.id)! : Number(cl.amount)),
    0
  );

  // Every item — patched or not — goes back through allocateCosts together,
  // since it spreads additionalCosts across the whole purchase by each
  // item's share of the subtotal; it has to see every item to do that.
  const merged = currentItems.map((it: { id: number; product_id: number; quantity: number; unit_cost: string | number }) => {
    const patch = itemPatchMap.get(it.id);
    return {
      id: it.id,
      productId: it.product_id,
      quantity: patch?.quantity ?? it.quantity,
      unitCost: patch?.unitCost ?? Number(it.unit_cost),
      oldQuantity: it.quantity,
    };
  });

  // Guard every quantity decrease against making stock negative — the same
  // check createStockAdjustment already does — before changing anything.
  for (const item of merged) {
    const delta = item.quantity - item.oldQuantity;
    if (delta < 0) {
      const product = await productsRepo.findProductByIdForUpdate(item.productId, client);
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND');
      const currentStock = await stockMovementsRepo.getCurrentStock(item.productId, client);
      if (currentStock + delta < 0) {
        throw new HttpError(409, 'EDIT_WOULD_MAKE_STOCK_NEGATIVE', undefined, {
          productId: item.productId,
          currentStock,
          requestedChange: delta,
        });
      }
    }
  }

  const allocated = allocateCosts(merged, newAdditionalCosts);
  let newTotalCost = 0;
  for (const item of allocated) {
    await purchasesRepo.updatePurchaseItem(
      item.id,
      {
        quantity: item.quantity,
        unitCost: item.unitCost,
        allocatedAdditionalCost: item.allocatedAdditionalCost,
        totalCost: item.totalCost,
      },
      client
    );
    newTotalCost += item.totalCost;

    const delta = item.quantity - item.oldQuantity;
    if (delta !== 0) {
      await stockMovementsRepo.insertStockMovement(
        {
          productId: item.productId,
          movementType: 'ADJUSTMENT',
          quantity: delta,
          referenceType: 'purchase_edit',
          referenceId: purchaseId,
          createdBy: actingUserId,
        },
        client
      );
    }
  }

  for (const cl of currentCostLines as Array<{ id: number }>) {
    if (costLinePatchMap.has(cl.id)) {
      await purchasesRepo.updateCostLineAmount(cl.id, costLinePatchMap.get(cl.id)!, client);
    }
  }

  await purchasesRepo.updatePurchaseTotals(purchaseId, { additionalCosts: newAdditionalCosts, totalCost: newTotalCost }, client);
}

export async function requestPurchaseEdit(input: {
  purchaseId: number;
  items: EditItemPatchInput[];
  costLines: EditCostLinePatchInput[];
  reason?: string;
  requester: AuthenticatedUser;
}) {
  const isOwner = input.requester.role === 'owner';
  if (!isOwner && !(input.reason && input.reason.trim())) {
    throw new HttpError(400, 'REASON_REQUIRED');
  }
  if (input.items.length === 0 && input.costLines.length === 0) {
    throw new HttpError(400, 'NOTHING_TO_CHANGE');
  }
  for (const item of input.items) {
    if (item.quantity <= 0) throw new HttpError(400, 'QUANTITY_MUST_BE_POSITIVE');
    if (item.unitCost < 0) throw new HttpError(400, 'UNIT_COST_MUST_BE_NON_NEGATIVE');
  }
  for (const line of input.costLines) {
    if (line.amount < 0) throw new HttpError(400, 'COST_LINE_AMOUNT_MUST_BE_NON_NEGATIVE');
  }

  return withTransaction(async (client) => {
    const purchase = await purchasesRepo.findPurchaseByIdForUpdate(input.purchaseId, client);
    if (!purchase) throw new HttpError(404, 'PURCHASE_NOT_FOUND');

    const existingItems: Array<{ id: number }> = await purchasesRepo.getPurchaseItemsForUpdate(input.purchaseId, client);
    const itemIds = new Set(existingItems.map((i) => i.id));
    for (const patch of input.items) {
      if (!itemIds.has(patch.purchaseItemId)) throw new HttpError(400, 'ITEM_NOT_ON_THIS_PURCHASE');
    }
    const existingCostLines: Array<{ id: number }> = await purchasesRepo.getAdditionalCostLinesForUpdate(
      input.purchaseId,
      client
    );
    const costLineIds = new Set(existingCostLines.map((c) => c.id));
    for (const patch of input.costLines) {
      if (!costLineIds.has(patch.costLineId)) throw new HttpError(400, 'COST_LINE_NOT_ON_THIS_PURCHASE');
    }

    if (isOwner) {
      const editRequest = await purchaseEditRequestsRepo.insertEditRequest(
        {
          purchaseId: input.purchaseId,
          proposedItems: input.items,
          proposedCostLines: input.costLines,
          reason: input.reason?.trim() || null,
          requestedBy: input.requester.id,
          status: 'APPROVED',
          reviewedBy: input.requester.id,
          reviewedAt: new Date(),
        },
        client
      );
      await applyPurchaseEdit(input.purchaseId, input.items, input.costLines, input.requester.id, client);
      await writeAuditLog(
        {
          userId: input.requester.id,
          action: 'PURCHASE_EDITED',
          entityType: 'purchase',
          entityId: input.purchaseId,
          details: { editRequestId: editRequest.id, autoApproved: true },
        },
        client
      );
      return { editRequest, purchase: await purchasesRepo.findPurchaseById(input.purchaseId, client) };
    }

    const existingPending = await purchaseEditRequestsRepo.findPendingForPurchase(input.purchaseId, client);
    if (existingPending) {
      throw new HttpError(409, 'PENDING_EDIT_ALREADY_EXISTS');
    }

    const editRequest = await purchaseEditRequestsRepo.insertEditRequest(
      {
        purchaseId: input.purchaseId,
        proposedItems: input.items,
        proposedCostLines: input.costLines,
        reason: input.reason!.trim(),
        requestedBy: input.requester.id,
        status: 'PENDING',
      },
      client
    );
    await writeAuditLog(
      {
        userId: input.requester.id,
        action: 'PURCHASE_EDIT_REQUESTED',
        entityType: 'purchase',
        entityId: input.purchaseId,
        details: { editRequestId: editRequest.id, reason: input.reason },
      },
      client
    );
    // Unlike the owner's own edit above, nothing has changed yet — the
    // returned `purchase` is still exactly what it was before this request.
    return { editRequest, purchase };
  });
}

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — mirrors
// sales.service.ts's identical addition for its own edit-request list: a
// real "old total → new total" headline, computed from the same formula
// createPurchase/applyPurchaseEdit already use (total_cost = sum of each
// line's quantity*unitCost, plus the sum of the cost lines) — no need to
// re-run allocateCosts's per-item proportional split just for a grand total.
export async function listEditRequests(status?: string) {
  const requests = await purchaseEditRequestsRepo.listEditRequests(status);
  return Promise.all(
    requests.map(async (req: any) => {
      let preview: { oldTotal: string; newTotal: number } | null = null;
      try {
        const purchase = await purchasesRepo.findPurchaseById(req.purchase_id);
        if (purchase) {
          const itemPatchMap = new Map(
            req.proposed_items.map((p: EditItemPatchInput) => [p.purchaseItemId, p])
          );
          const costPatchMap = new Map(
            req.proposed_cost_lines.map((p: EditCostLinePatchInput) => [p.costLineId, p])
          );
          let newTotal = 0;
          for (const item of purchase.items ?? []) {
            const patch = itemPatchMap.get(item.id) as EditItemPatchInput | undefined;
            newTotal += patch ? patch.quantity * patch.unitCost : Number(item.quantity) * Number(item.unit_cost);
          }
          for (const line of purchase.additional_cost_lines ?? []) {
            const patch = costPatchMap.get(line.id) as EditCostLinePatchInput | undefined;
            newTotal += patch ? patch.amount : Number(line.amount);
          }
          preview = { oldTotal: purchase.total_cost, newTotal };
        }
      } catch {
        // Non-fatal — a stale/malformed patch just skips the preview; the
        // itemized diff still renders without it.
      }
      return { ...req, preview };
    })
  );
}

export async function approvePurchaseEdit(editRequestId: number, owner: AuthenticatedUser, notes?: string) {
  return withTransaction(async (client) => {
    const editRequest = await purchaseEditRequestsRepo.findByIdForUpdate(editRequestId, client);
    if (!editRequest) throw new HttpError(404, 'EDIT_REQUEST_NOT_FOUND');
    if (editRequest.status !== 'PENDING') throw new HttpError(409, 'EDIT_REQUEST_ALREADY_REVIEWED');

    const items: EditItemPatchInput[] = editRequest.proposed_items ?? [];
    const costLines: EditCostLinePatchInput[] = editRequest.proposed_cost_lines ?? [];

    await applyPurchaseEdit(editRequest.purchase_id, items, costLines, owner.id, client);
    const reviewed = await purchaseEditRequestsRepo.reviewEditRequest(editRequestId, 'APPROVED', owner.id, notes ?? null, client);

    await writeAuditLog(
      {
        userId: owner.id,
        action: 'PURCHASE_EDIT_APPROVED',
        entityType: 'purchase',
        entityId: editRequest.purchase_id,
        details: { editRequestId, notes },
      },
      client
    );
    return { editRequest: reviewed, purchase: await purchasesRepo.findPurchaseById(editRequest.purchase_id, client) };
  });
}

export async function rejectPurchaseEdit(editRequestId: number, owner: AuthenticatedUser, notes?: string) {
  return withTransaction(async (client) => {
    const editRequest = await purchaseEditRequestsRepo.findByIdForUpdate(editRequestId, client);
    if (!editRequest) throw new HttpError(404, 'EDIT_REQUEST_NOT_FOUND');
    if (editRequest.status !== 'PENDING') throw new HttpError(409, 'EDIT_REQUEST_ALREADY_REVIEWED');

    const reviewed = await purchaseEditRequestsRepo.reviewEditRequest(editRequestId, 'REJECTED', owner.id, notes ?? null, client);
    await writeAuditLog(
      {
        userId: owner.id,
        action: 'PURCHASE_EDIT_REJECTED',
        entityType: 'purchase',
        entityId: editRequest.purchase_id,
        details: { editRequestId, notes },
      },
      client
    );
    return reviewed;
  });
}
