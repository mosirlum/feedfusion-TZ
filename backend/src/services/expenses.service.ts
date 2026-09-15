import { HttpError } from '../middleware/errorHandler';
import * as expensesRepo from '../db/expensesRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

export type ExpenseType = 'PER_PURCHASE' | 'MONTHLY' | 'PERIODIC';
const VALID_EXPENSE_TYPES: ExpenseType[] = ['PER_PURCHASE', 'MONTHLY', 'PERIODIC'];

/**
 * Section 24 (mvp-spec.md): expenses recorded here are GENERAL OPERATING costs
 * (electricity, rent, wages, etc). They must never touch product cost —
 * inventory-related costs (e.g. delivery transport that's part of a supplier's
 * invoice) are captured instead as `purchases.additional_costs` and allocated
 * into unit cost at purchase time (see purchases.service.ts allocateCosts).
 * Keeping the two separate is what Section 24 explicitly asks for.
 *
 * `expenseType` (added in migration 009, flagged in CLAUDE.md — not in the
 * original schema) classifies WHEN an expense recurs, for reporting: MONTHLY
 * (rent, wages), PERIODIC (occasional — repairs, licences), or PER_PURCHASE
 * (an incidental cash cost tied to a specific delivery that is NOT already on
 * the supplier's invoice, e.g. loading labor paid to the truck crew). If a
 * transport/freight cost IS part of the supplier's invoice for that delivery,
 * it belongs on the Purchase's "Additional costs" field, not here — entering
 * it in both places would double-count it into inventory value/COGS.
 */
export async function createExpense(input: {
  category: string;
  amount: number;
  description?: string;
  expenseDate?: string;
  expenseType?: string;
  createdBy: AuthenticatedUser;
}) {
  if (!input.category || !input.category.trim()) {
    throw new HttpError(400, 'CATEGORY_REQUIRED');
  }
  if (typeof input.amount !== 'number' || input.amount <= 0) {
    throw new HttpError(400, 'AMOUNT_MUST_BE_POSITIVE');
  }
  const expenseType = (input.expenseType ?? 'PERIODIC') as ExpenseType;
  if (!VALID_EXPENSE_TYPES.includes(expenseType)) {
    throw new HttpError(400, 'INVALID_EXPENSE_TYPE');
  }

  const expense = await expensesRepo.insertExpense({
    category: input.category.trim(),
    amount: input.amount,
    description: input.description ?? null,
    expenseDate: input.expenseDate ?? null,
    expenseType,
    createdBy: input.createdBy.id,
  });

  await writeAuditLog({
    userId: input.createdBy.id,
    action: 'EXPENSE_RECORDED',
    entityType: 'expense',
    entityId: expense.id,
    details: { category: expense.category, amount: input.amount, expenseType },
  });

  return expense;
}

export function listExpenses(filters: { from?: string; to?: string; expenseType?: string }) {
  return expensesRepo.listExpenses(filters);
}
