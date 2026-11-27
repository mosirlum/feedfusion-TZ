import * as salesRepo from '../db/salesRepo';
import * as inventoryService from './inventory.service';
import { getApprovalSummary } from './approvalCenter.service';

/**
 * "Welcome back" summary (2026-11-27, CLAUDE.md #99) — the chatbot/voice
 * greeting's data: what happened since this user's previous login. Every
 * figure is computed live from the same tables the rest of the app already
 * reads (never a second, driftable copy) — nothing here is AI-generated.
 *
 * `sinceIso` is the PREVIOUS last_login_at the login response returned
 * (null on a first-ever login, in which case this returns null — there is
 * nothing to summarize yet).
 */
export interface WelcomeBackSummary {
  sinceIso: string;
  salesCount: number;
  salesTotal: number;
  grossProfit: number | null; // owner only (BR-24)
  newCreditCount: number;
  newCreditAmount: number;
  lowStockCount: number | null; // owner only (BR-24: stock quantity alone is fine, but kept owner-only for symmetry with the rest of this summary)
  pendingApprovalsCount: number | null; // owner only
}

export async function getWelcomeBackSummary(
  requester: { id: number; role: string },
  sinceIso: string | null
): Promise<WelcomeBackSummary | null> {
  if (!sinceIso) return null;

  const ownerView = requester.role === 'owner';
  const sales = await salesRepo.getSalesSince(sinceIso, ownerView, requester.id);

  let lowStockCount: number | null = null;
  let pendingApprovalsCount: number | null = null;
  if (ownerView) {
    const [lowStock, approvals] = await Promise.all([inventoryService.getLowStock(), getApprovalSummary()]);
    lowStockCount = lowStock.length;
    pendingApprovalsCount = approvals.pending.total;
  }

  return {
    sinceIso,
    salesCount: sales.salesCount,
    salesTotal: sales.salesTotal,
    grossProfit: ownerView ? sales.grossProfit : null,
    newCreditCount: sales.newCreditCount,
    newCreditAmount: sales.newCreditAmount,
    lowStockCount,
    pendingApprovalsCount,
  };
}
