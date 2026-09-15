import * as priceProposalsRepo from '../db/priceProposalsRepo';
import * as saleEditRequestsRepo from '../db/saleEditRequestsRepo';
import * as purchaseEditRequestsRepo from '../db/purchaseEditRequestsRepo';

/**
 * Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — the owner
 * asked for a single unified inbox (previously three separate tabs: Price
 * Proposals, Sale Corrections, Purchase Corrections) with real stat cards
 * and a Recent Activity feed. Both new endpoints here (`/approvals/summary`
 * and `/approvals/recent-activity`) simply combine the three existing
 * approval tables' own numbers — no new table, nothing fabricated. A
 * "Priority" field shown in the owner's reference mockup was deliberately
 * left out: nothing in any of these three tables records a priority, and
 * the owner chose to drop it rather than have one invented from an
 * arbitrary threshold (confirmed via AskUserQuestion).
 */

type Counts = {
  pending: string;
  approved_today: string;
  approved_yesterday: string;
  rejected_today: string;
};

function n(v: string | number | undefined | null): number {
  return Number(v ?? 0);
}

export async function getApprovalSummary() {
  const [price, sale, purchase]: Counts[] = await Promise.all([
    priceProposalsRepo.getApprovalCounts(),
    saleEditRequestsRepo.getApprovalCounts(),
    purchaseEditRequestsRepo.getApprovalCounts(),
  ]);

  return {
    pending: {
      price: n(price.pending),
      sale: n(sale.pending),
      purchase: n(purchase.pending),
      total: n(price.pending) + n(sale.pending) + n(purchase.pending),
    },
    approvedToday: n(price.approved_today) + n(sale.approved_today) + n(purchase.approved_today),
    approvedYesterday: n(price.approved_yesterday) + n(sale.approved_yesterday) + n(purchase.approved_yesterday),
    // Scoped to "today" rather than an all-time/backlog count, for the same
    // reason Approved Today is — a resolved request needs no further
    // action, so the stat reads as "what happened today," not a queue.
    rejectedToday: n(price.rejected_today) + n(sale.rejected_today) + n(purchase.rejected_today),
  };
}

export interface RecentActivityItem {
  id: string;
  type: 'price' | 'sale' | 'purchase';
  action: 'APPROVED' | 'REJECTED';
  label: string;
  reviewedByName: string | null;
  reviewedAt: string;
}

export async function getRecentActivity(limit = 8): Promise<RecentActivityItem[]> {
  const [priceRows, saleRows, purchaseRows] = await Promise.all([
    priceProposalsRepo.listRecentlyReviewed(limit),
    saleEditRequestsRepo.listRecentlyReviewed(limit),
    purchaseEditRequestsRepo.listRecentlyReviewed(limit),
  ]);

  const merged: RecentActivityItem[] = [
    ...priceRows.map((r: any) => ({
      id: `price-${r.id}`,
      type: 'price' as const,
      action: r.status as 'APPROVED' | 'REJECTED',
      label: r.product_name,
      reviewedByName: r.reviewed_by_name,
      reviewedAt: r.reviewed_at,
    })),
    ...saleRows.map((r: any) => ({
      id: `sale-${r.id}`,
      type: 'sale' as const,
      action: r.status as 'APPROVED' | 'REJECTED',
      label: r.invoice_number ?? `Sale #${r.id}`,
      reviewedByName: r.reviewed_by_name,
      reviewedAt: r.reviewed_at,
    })),
    ...purchaseRows.map((r: any) => ({
      id: `purchase-${r.id}`,
      type: 'purchase' as const,
      action: r.status as 'APPROVED' | 'REJECTED',
      label: r.reference_number ?? `Purchase #${r.id}`,
      reviewedByName: r.reviewed_by_name,
      reviewedAt: r.reviewed_at,
    })),
  ];

  merged.sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());
  return merged.slice(0, limit);
}
