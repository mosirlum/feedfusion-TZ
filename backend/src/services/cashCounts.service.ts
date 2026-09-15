import { HttpError } from '../middleware/errorHandler';
import * as cashCountsRepo from '../db/cashCountsRepo';
import * as salesRepo from '../db/salesRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Section 21 / BR-21 / BR-33: expected cash is auto-computed from the day's
 * real CASH payments received (see salesRepo.sumCashReceivedForDate — a
 * sale's total is no longer the right figure since credit/partial sales,
 * CLAUDE.md #50: only what was actually collected in cash, on this date,
 * counts here), never entered by hand. The owner enters only what was
 * physically counted; the difference is derived, never accepted from the
 * client, and a discrepancy is recorded with notes rather than treated as
 * an accusation.
 */
export async function recordCashCount(input: {
  countDate?: string;
  actualCash: number;
  notes?: string;
  countedBy: AuthenticatedUser;
}) {
  if (typeof input.actualCash !== 'number' || input.actualCash < 0) {
    throw new HttpError(400, 'ACTUAL_CASH_MUST_BE_NON_NEGATIVE');
  }

  const countDate = input.countDate ?? todayIso();
  const expectedCash = await salesRepo.sumCashReceivedForDate(countDate);
  const difference = input.actualCash - expectedCash;

  const count = await cashCountsRepo.insertCashCount({
    countDate,
    expectedCash,
    actualCash: input.actualCash,
    difference,
    notes: input.notes ?? null,
    countedBy: input.countedBy.id,
  });

  await writeAuditLog({
    userId: input.countedBy.id,
    action: 'CASH_COUNT_RECORDED',
    entityType: 'cash_count',
    entityId: count.id,
    details: { countDate, expectedCash, actualCash: input.actualCash, difference },
  });

  return count;
}

export function listCashCounts(filters: { from?: string; to?: string }) {
  return cashCountsRepo.listCashCounts(filters);
}

export async function getCashControlSummary() {
  const today = todayIso();
  const [expectedCashToday, latestCount, weekCounts] = await Promise.all([
    salesRepo.sumCashReceivedForDate(today),
    cashCountsRepo.getLatestCount(),
    cashCountsRepo.getWeekCounts(),
  ]);
  return {
    expectedCashToday,
    latestCount,
    countsThisWeek: weekCounts.countsThisWeek,
    // Whether today itself has been counted yet — not a stored status, just
    // "has a cash_counts row with count_date = today been created."
    pendingToday: weekCounts.countsToday === 0 ? 1 : 0,
  };
}
