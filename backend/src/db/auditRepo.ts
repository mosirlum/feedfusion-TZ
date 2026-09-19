import { PoolClient } from 'pg';
import { pool } from './pool';

export interface AuditEntry {
  userId: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  details?: Record<string, unknown>;
}

/**
 * Writes one audit_logs row. Accepts an optional transaction client so it
 * can be included atomically inside a larger transaction (sale completion,
 * price approval, stock adjustment, ...) — per CLAUDE.md rule #7, every
 * important action needs an audit entry, and it must not exist if the rest
 * of the transaction rolled back.
 */
export async function writeAuditLog(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [entry.userId, entry.action, entry.entityType ?? null, entry.entityId ?? null, entry.details ? JSON.stringify(entry.details) : null]
  );
}

/**
 * Audit Log Center (2026-09-12, CLAUDE.md #43) — the page's "Feature" tabs
 * (Sales/Purchases/Stock/...) group the fixed set of action codes this app
 * can write. This is a plain code lookup, not a database column, since the
 * set of actions is fixed by what's in the codebase, not by data — every
 * action written anywhere in this app is listed here; anything not listed
 * (a genuinely unmapped future action) falls into "Others" as a safety net
 * rather than silently disappearing from every feature tab.
 */
const FEATURE_ACTIONS: Record<string, string[]> = {
  Sales: [
    'SALE_COMPLETED',
    'SALE_VOIDED',
    'SALE_DETAILS_UPDATED',
    'SALE_EDITED',
    'SALE_EDIT_REQUESTED',
    'SALE_EDIT_APPROVED',
    'SALE_EDIT_REJECTED',
    'DISCOUNT_APPLIED_HIGH',
    // Credit sales (2026-09-12, CLAUDE.md #50) — topping up a PARTIAL sale's
    // balance later.
    'PAYMENT_RECORDED',
  ],
  Purchases: ['PURCHASE_RECORDED', 'PURCHASE_EDITED', 'PURCHASE_EDIT_REQUESTED', 'PURCHASE_EDIT_APPROVED', 'PURCHASE_EDIT_REJECTED'],
  Stock: ['STOCK_ADJUSTED', 'STOCK_COUNT_RECORDED', 'STOCK_COUNT_APPROVED', 'STOCK_COUNT_REJECTED'],
  Cash: ['CASH_COUNT_RECORDED'],
  Expenses: ['EXPENSE_RECORDED'],
  'Price Proposals': ['PRICE_PROPOSED', 'PRICE_APPROVED', 'PRICE_REJECTED'],
  Products: ['PRODUCT_CREATED', 'PRODUCT_ACTIVATED', 'PRODUCT_DEACTIVATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED'],
  // Password reset/change + profile self-service (2026-09-12, CLAUDE.md #47).
  Users: ['USER_PASSWORD_RESET', 'USER_PASSWORD_CHANGED', 'USER_PROFILE_UPDATED'],
  // Customers + Quotations (2026-09-12, CLAUDE.md #49).
  Customers: ['CUSTOMER_CREATED', 'CUSTOMER_UPDATED'],
  Quotations: ['QUOTATION_CREATED', 'QUOTATION_STATUS_CHANGED', 'QUOTATION_CONVERTED'],
  Settings: ['BUSINESS_SETTINGS_UPDATED'],
};
export const AUDIT_FEATURES = [
  'Sales',
  'Purchases',
  'Stock',
  'Cash',
  'Expenses',
  'Price Proposals',
  'Products',
  'Users',
  'Customers',
  'Quotations',
  'Settings',
  'Others',
] as const;
const ALL_KNOWN_ACTIONS = Object.values(FEATURE_ACTIONS).flat();
export const ALL_AUDIT_ACTIONS = ALL_KNOWN_ACTIONS;

function featureForAction(action: string): string {
  for (const [feature, actions] of Object.entries(FEATURE_ACTIONS)) {
    if (actions.includes(action)) return feature;
  }
  return 'Others';
}

// The only action that flags something worth the owner's attention rather
// than a plain record of something that happened normally — every other
// logged action is, by construction, one that already succeeded: a failed
// action is never written, since writeAuditLog always runs inside the same
// transaction as the action it's recording (see the comment above).
const WARNING_ACTIONS = new Set(['DISCOUNT_APPLIED_HIGH']);
function statusForAction(action: string): 'Success' | 'Warning' {
  return WARNING_ACTIONS.has(action) ? 'Warning' : 'Success';
}

export interface AuditLogFilters {
  entityType?: string;
  entityId?: number;
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
  userId?: number;
  action?: string;
  feature?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// Sortable columns the table's column headers can click through to — an
// allowlist (never the raw query param) since this feeds straight into
// ORDER BY. `details` sorts as text — not hugely meaningful for a JSON blob,
// but it's a real, working sort rather than a decorative chevron with
// nothing behind it.
const SORTABLE_COLUMNS: Record<string, string> = {
  created_at: 'al.created_at',
  action: 'al.action',
  user_name: 'u.name',
  details: 'al.details::text',
};

function buildWhere(filters: AuditLogFilters): { where: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.entityType) {
    values.push(filters.entityType);
    conditions.push(`al.entity_type = $${values.length}`);
  }
  if (filters.entityId !== undefined) {
    values.push(filters.entityId);
    conditions.push(`al.entity_id = $${values.length}`);
  }
  if (filters.from) {
    values.push(filters.from);
    conditions.push(`al.created_at::date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`al.created_at::date <= $${values.length}`);
  }
  if (filters.userId !== undefined) {
    values.push(filters.userId);
    conditions.push(`al.user_id = $${values.length}`);
  }
  if (filters.action) {
    values.push(filters.action);
    conditions.push(`al.action = $${values.length}`);
  }
  if (filters.feature && filters.feature !== 'All') {
    if (filters.feature === 'Others') {
      values.push(ALL_KNOWN_ACTIONS);
      conditions.push(`al.action <> ALL($${values.length})`);
    } else if (FEATURE_ACTIONS[filters.feature]) {
      values.push(FEATURE_ACTIONS[filters.feature]);
      conditions.push(`al.action = ANY($${values.length})`);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, values };
}

export async function listAuditLogs(filters: AuditLogFilters) {
  const { where, values } = buildWhere(filters);
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 15;
  const offset = (page - 1) * pageSize;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(DISTINCT al.user_id)::int AS unique_users, COUNT(DISTINCT al.action)::int AS different_actions
     FROM audit_logs al
     ${where}`,
    values
  );
  const totals = countRows[0];

  const { rows: latestRows } = await pool.query(
    `SELECT al.created_at, u.name AS user_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT 1`,
    values
  );

  const sortColumn = (filters.sortBy && SORTABLE_COLUMNS[filters.sortBy]) || SORTABLE_COLUMNS.created_at;
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  const rowValues = [...values, pageSize, offset];
  const { rows } = await pool.query(
    `SELECT al.*, u.name AS user_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY ${sortColumn} ${sortDir}, al.id ${sortDir}
     LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`,
    rowValues
  );

  return {
    rows: rows.map((r) => ({ ...r, feature: featureForAction(r.action), status: statusForAction(r.action) })),
    pagination: {
      page,
      pageSize,
      totalRows: totals.total,
      totalPages: Math.max(1, Math.ceil(totals.total / pageSize)),
    },
    summary: {
      totalEvents: totals.total,
      uniqueUsers: totals.unique_users,
      differentActions: totals.different_actions,
      latestActivity: latestRows[0] ? { createdAt: latestRows[0].created_at, userName: latestRows[0].user_name as string | null } : null,
    },
  };
}
