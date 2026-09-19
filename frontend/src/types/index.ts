export type UserRole = 'owner' | 'sales' | 'manager';
export type UserStatus = 'active' | 'inactive';

export interface PublicUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  // Added migration 014 (2026-09-12, CLAUDE.md #47) — forced password change
  // (first login, or right after an owner reset) and a self-service avatar
  // photo stored as a base64 data: URL (no upload middleware exists on this
  // backend, see CLAUDE.md #47 for why).
  must_change_password: boolean;
  avatar_data_url: string | null;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  category_name?: string | null;
  unit: string;
  active_price: string | null;
  active_price_source: 'OWNER_SET' | 'APPROVED_PROPOSAL' | null;
  minimum_stock: number;
  status: 'active' | 'inactive';
  created_at?: string;
}

// One row of GET /reports/products?from=&to= (2026-09-11: reused, unchanged,
// to power the Products page's "Top Selling Products" panel).
export interface ProductSalesRow {
  product_id: number;
  product_name: string;
  unit: string;
  quantity_sold: string;
  revenue: string;
  cost: string;
  gross_profit: string;
}

// GET /products/stock-levels (2026-09-11, New Sale page) — quantity only,
// no cost fields, so it's safe for a sales-role viewer unlike InventoryRow.
export interface StockLevel {
  product_id: number;
  current_stock: number;
}

export interface InventoryRow extends Omit<Product, 'status'> {
  current_stock: number;
  last_unit_cost: string | null;
  // Inventory rows overwrite Product.status with the computed stock status
  // (see inventory.service.ts) — 'active'/'inactive' is not present here.
  status: 'HEALTHY' | 'LOW' | 'OUT_OF_STOCK';
  stock_value_cost: number | null;
  stock_value_selling: number | null;
  // Timestamp of this product's most recent stock_movements row, or null if
  // it has never had one (2026-09-11, Inventory page redesign) — real data,
  // used to show a genuine "Last updated" timestamp rather than a fake one.
  last_movement_at?: string | null;
}

export interface PriceProposal {
  id: number;
  product_id: number;
  product_name?: string;
  category_name?: string | null;
  proposed_price: string;
  current_active_price: string | null;
  proposed_by: number;
  proposed_by_name?: string;
  // Added for the Change Approval Center redesign (2026-09-11, CLAUDE.md
  // #36) — role label under the requester's name, and who resolved it.
  proposed_by_role?: UserRole;
  reviewed_by_name?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  notes: string | null;
  created_at: string;
  reviewed_at?: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
  // Added to GET /suppliers's response 2026-09-11 (Suppliers page redesign)
  // — computed from purchases, never stored on the supplier row itself.
  total_purchases?: string;
  purchase_count?: number;
  last_purchase_date?: string | null;
}

// Backs the redesigned Suppliers page's stat cards, charts, and insights
// (2026-09-11) — see CLAUDE.md. Every figure here is real and computed;
// there's deliberately no "average delivery time" or similar, since
// nothing in this schema records an expected-vs-actual delivery date.
export interface SupplierStats {
  total_suppliers: number;
  new_suppliers_this_month: number;
  total_this_month: string;
  total_last_month: string;
  purchase_count_this_month: number;
  bySupplier: Array<{ id: number; name: string; total_cost_this_month: string }>;
}

export interface PurchaseAdditionalCostLine {
  id: number;
  label: string;
  amount: string;
}

export interface Purchase {
  id: number;
  supplier_id: number;
  supplier_name?: string;
  reference_number: string;
  purchase_date: string;
  additional_costs: string;
  total_cost: string;
  notes: string | null;
  // One photo of the supplier's invoice/quotation (CLAUDE.md #68) — a
  // base64 data: URL, same pattern as the user avatar photo. Optional.
  // Only present when a single purchase is fetched (GET /purchases/:id) —
  // the list endpoint sends the cheap `has_document` boolean instead, to
  // avoid pulling every photo on every page load.
  document_data_url?: string | null;
  has_document?: boolean;
  items?: PurchaseItem[];
  additional_cost_lines?: PurchaseAdditionalCostLine[];
  item_count?: string;
}

export interface PurchaseItem {
  id: number;
  product_id: number;
  product_name?: string;
  quantity: number;
  unit_cost: string;
  allocated_additional_cost: string;
  total_cost: string;
}

// Correcting a mistake on an already-recorded purchase (2026-09-11) — a
// sales user's request sits PENDING until the owner approves it; the
// owner's own request auto-approves, mirroring PriceProposal above. Only
// quantity/unit cost (existing items) and amount (existing cost lines) can
// be proposed — never the supplier, date, or which lines exist.
export interface PurchaseEditRequest {
  id: number;
  purchase_id: number;
  reference_number?: string;
  supplier_id?: number;
  supplier_name?: string;
  total_cost?: string;
  proposed_items: Array<{ purchaseItemId: number; quantity: number; unitCost: number }>;
  proposed_cost_lines: Array<{ costLineId: number; amount: number }>;
  reason: string | null;
  requested_by: number;
  requested_by_name?: string;
  requested_by_role?: UserRole;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by: number | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  // Real "old total → new total" headline, computed server-side from the
  // same formula createPurchase/applyPurchaseEdit use (2026-09-11, Change
  // Approval Center redesign, CLAUDE.md #36). `null` only if the source
  // purchase/items could no longer be read when the list was built.
  preview?: { oldTotal: string; newTotal: number } | null;
}

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  unit: string;
  unit_price: string;
  quantity: number;
  line_subtotal: string;
  discount_type: 'NONE' | 'FIXED' | 'PERCENT';
  discount_value: string;
  discount_amount: string;
  line_total: string;
  discount_reason: string | null;
}

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY';

// A row of `payments` — one sale can now have several (a deposit at
// completion time, plus one or more later top-ups), 2026-09-12, CLAUDE.md #50.
export interface Payment {
  id?: number;
  amount: string;
  method: PaymentMethod;
  created_at: string;
}

export interface Sale {
  id: number;
  invoice_number: string;
  sale_date: string;
  subtotal: string;
  total_discount: string;
  total: string;
  status: 'COMPLETED' | 'VOIDED';
  served_by: number;
  served_by_name?: string;
  customer_name: string | null;
  items: SaleItem[];
  payments?: Payment[];
  void_reason?: string | null;
  // GET /sales (list) attaches this real per-sale count (2026-09-11, Sales
  // History redesign) instead of eagerly loading every sale's items — the
  // list view doesn't otherwise fetch `items`, so this field is absent from
  // POST /sales's response and present here instead.
  item_count?: number;
  // Added migration 012 (2026-09-11, Change Approval Center) — save
  // immediately via PATCH /sales/:id, no approval needed (CLAUDE.md #35).
  customer_phone?: string | null;
  notes?: string | null;
  // Full "Sold To" + credit-sale fields (2026-09-12, migration 018,
  // CLAUDE.md #50). amount_paid/balance_due are never stored — always
  // derived server-side from SUM(payments.amount), present on both GET
  // /sales (list) and GET /sales/:id.
  customer_address?: string | null;
  customer_id?: number | null;
  payment_status: 'PAID' | 'PARTIAL';
  amount_paid: string;
  balance_due: string;
  // POST /sales only (2026-09-13, CLAUDE.md #66) — lines whose discount
  // exceeded the shop's limit; the sale still completed (no more owner-PIN
  // gate), this is just what the POS shows the cashier as a heads-up.
  highDiscountWarnings?: Array<{ productName: string; effectivePct: number; maxPct: number }>;
  // GET /sales (list) only — a cheap per-row subquery so the table can show
  // a real payment-method badge without fetching every sale's full
  // `payments` array (2026-09-12, CLAUDE.md #50).
  last_payment_method?: PaymentMethod;
  payment_method_count?: number;
  // Added migration 014 (2026-09-12, CLAUDE.md #47) — set the first time this
  // sale's receipt is actually printed (POS "Sale Complete" modal, or Sales
  // History's own print button). Never overwritten by printing again later;
  // deliberately doesn't affect `status` — a sale is COMPLETED the moment
  // it's rung up either way (BR-04). Null/absent means not yet printed.
  printed_at?: string | null;
}

// The POST /sales/:id/edit-requests request-body shape (2026-09-11, Change
// Approval Center, CLAUDE.md #35) — snake_case, matching api-reference.md's
// documented body exactly (what EditSaleModal.tsx actually sends over the
// wire). Deliberately excludes product_id — swapping which product a line
// refers to isn't supported; that's still a void-and-re-enter case, same as
// Purchases. Total/payment amount aren't here either — both are always
// recomputed server-side from quantity/unit_price/discount, never typed in
// directly.
export interface ProposedSaleItem {
  sale_item_id: number;
  quantity: number;
  unit_price: number;
  discount_type: 'NONE' | 'FIXED' | 'PERCENT';
  discount_value: number;
  discount_reason: string | null;
}

// The shape actually PERSISTED in sale_edit_requests.proposed_items and
// returned by GET /sales/edit-requests — camelCase, matching the backend's
// own ProposedSaleItemPatch (sales.controller.ts translates the snake_case
// POST body above into this before storing it; see requestSaleEditHandler).
// Fixed 2026-09-11, CLAUDE.md #36 — this file previously reused
// ProposedSaleItem (snake_case) for both purposes, which silently broke the
// Sale Corrections diff display: it read `patch.sale_item_id`, a key that
// never existed on data returned from the API (the real key is
// `saleItemId`), so every "current" lookup failed and every line rendered
// as a mystery change from "?".
export interface ProposedSaleItemPatch {
  saleItemId: number;
  quantity: number;
  unitPrice: number;
  discountType: 'NONE' | 'FIXED' | 'PERCENT';
  discountValue: number;
  discountReason: string | null;
}

export interface SaleEditRequest {
  id: number;
  sale_id: number;
  invoice_number?: string;
  customer_name?: string | null;
  sale_total?: string;
  proposed_items: ProposedSaleItemPatch[];
  reason: string | null;
  requested_by: number;
  requested_by_name?: string;
  requested_by_role?: UserRole;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by: number | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  // Real "old total → new total" headline, computed server-side
  // (2026-09-11, CLAUDE.md #36) — see PurchaseEditRequest.preview above.
  preview?: { oldTotal: string; newTotal: number } | null;
}

// GET /approvals/summary (2026-09-11, Change Approval Center redesign,
// CLAUDE.md #36) — backs the unified page's 3 stat cards. Every number is a
// real count from price_proposals/sale_edit_requests/purchase_edit_requests
// — there's deliberately no "priority" breakdown, since nothing in any of
// those tables tracks one (the owner chose to drop it rather than have one
// invented from an arbitrary threshold).
export interface ApprovalSummary {
  pending: { price: number; sale: number; purchase: number; total: number };
  approvedToday: number;
  approvedYesterday: number;
  rejectedToday: number;
}

// GET /approvals/recent-activity (same redesign) — the Recent Activity
// sidebar feed, merged and sorted across all three approval types.
export interface RecentActivityItem {
  id: string;
  type: 'price' | 'sale' | 'purchase';
  action: 'APPROVED' | 'REJECTED';
  label: string;
  reviewedByName: string | null;
  reviewedAt: string;
}

// GET /sales/stats?from=&to= (2026-09-11, Sales History redesign) — backs
// the page's stat cards and their real "vs previous period" comparison
// (the immediately preceding range of the same length). A `*ChangePct` is
// `null`, never a fabricated 0%, when the previous period had no activity
// to compare against. grossProfit/grossProfitChangePct are present only in
// an owner's response — BR-24, enforced server-side, not by this type.
export interface SalesStats {
  totalSales: number;
  transactionCount: number;
  itemsSold: number;
  totalSalesChangePct: number | null;
  transactionCountChangePct: number | null;
  itemsSoldChangePct: number | null;
  grossProfit?: number;
  grossProfitChangePct?: number | null;
}

export interface CartLine {
  product: Product;
  quantity: number;
  discountType: 'NONE' | 'FIXED' | 'PERCENT';
  discountValue: number;
  discountReason: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  movement_type: 'PURCHASE' | 'SALE' | 'VOID_REVERSAL' | 'ADJUSTMENT' | 'COUNT_CORRECTION';
  quantity: number;
  balance_after: number;
  created_by_name?: string;
  created_at: string;
}

export interface StockCount {
  id: number;
  product_id: number;
  product_name?: string;
  unit?: string;
  category_name?: string | null;
  expected_qty: number;
  physical_qty: number;
  difference: number;
  reason: string;
  // Free-text explanation alongside the reason pill (2026-09-12, Stock
  // Count Center redesign, migration 013, CLAUDE.md #37).
  notes?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  counted_by_name?: string;
  counted_by_role?: UserRole;
  approved_by_name?: string | null;
  created_at: string;
  // When approved/rejected — separate from created_at (submission time),
  // same reason every other approval table has one (migration 013).
  reviewed_at?: string | null;
}

// GET /stock-counts/summary (same redesign) — backs the 3 stat cards.
// "pendingVarianceUnits" is the sum of |difference| across PENDING counts
// only — a judgment call, since nothing pins down whether "Total Variance"
// should mean current unresolved exposure or an all-time historical total;
// see CLAUDE.md #37.
export interface StockCountSummary {
  pending: number;
  pendingVarianceUnits: number;
  countedToday: number;
  countedYesterday: number;
  rejectedToday: number;
}

export interface StockCountActivityEvent {
  id: string;
  action: 'RECORDED' | 'APPROVED' | 'REJECTED';
  productName: string;
  quantity: number;
  actorName: string;
  at: string;
}

export interface StockAdjustment {
  id: number;
  product_id: number;
  product_name?: string;
  unit?: string;
  category_id?: number | null;
  category_name?: string;
  quantity: number;
  reason: string;
  notes: string | null;
  created_by_name?: string;
  created_by_role?: string;
  approved_by_name?: string;
  created_at: string;
}

export interface StockAdjustmentsSummary {
  adjustmentsToday: number;
  adjustmentsYesterday: number;
  writtenOffLast7: number;
  writtenOffHint: string;
  increasedLast7: number;
  decreasedLast7: number;
}

export type ExpenseType = 'PER_PURCHASE' | 'MONTHLY' | 'PERIODIC';

export interface Expense {
  id: number;
  category: string;
  amount: string;
  description: string | null;
  expense_date: string;
  expense_type: ExpenseType;
  created_by_name?: string;
  created_at?: string;
}

// Purchase Costs report (2026-09-12, CLAUDE.md #40).
export interface PurchaseCostRow {
  id: number;
  reference_number: string;
  purchase_date: string;
  supplier_name: string;
  total_cost: string;
  additional_costs: string;
  goods_subtotal: string;
}

export interface PurchaseCostsReport {
  purchases: PurchaseCostRow[];
  summary: {
    purchaseCount: number;
    totalGoodsValue: number;
    totalAdditionalCosts: number;
    totalPerPurchaseExpenses: number;
    combinedOverhead: number;
  };
  costLinesByLabel: { label: string; total: string }[];
  perPurchaseExpenses: Expense[];
  perPurchaseByCategory: { category: string; total: string }[];
}

// Reports "Sales" tab redesign (2026-09-12, CLAUDE.md #41).
export interface DailySalesPoint {
  date: string;
  revenue: number;
  transactions: number;
  discount: number;
  voided: number;
  grossProfit: number;
}

export interface RevenueByCategoryRow {
  category_name: string;
  quantity_sold: string;
  revenue: string;
}

export interface RevenueByStaffRow {
  user_id: number;
  user_name: string;
  transaction_count: number;
  revenue: string;
}

export interface SalesOverviewReport {
  current: { totalRevenue: number; transactionCount: number; totalDiscount: number; voidedCount: number; grossProfit: number };
  changePct: {
    totalRevenue: number | null;
    transactionCount: number | null;
    totalDiscount: number | null;
    voidedCount: number | null;
    grossProfit: number | null;
  };
  dailySeries: DailySalesPoint[];
  revenueByCategory: RevenueByCategoryRow[];
  revenueByStaff: RevenueByStaffRow[];
  topProducts: ProductSalesRow[];
  totalQuantitySold: number;
  lowStockCount: number;
}

export interface DashboardToday {
  date: string;
  totalSales: number;
  transactionCount: number;
  totalDiscount: number;
  grossProfit: number;
  expenses: number;
  estimatedNet: number;
  lowStockAlert: boolean;
  lowStockCount: number;
  lowStockProducts: InventoryRow[];
  topProducts: Array<{ product_id: number; product_name: string; quantity_sold: number; revenue: string }>;

  // Added for the whole-app visual redesign (2026-09-12, CLAUDE.md #56/#57) —
  // every field below is real, queried data, not a fabricated widget.
  totalPurchasesToday: number;
  currentStockValue: number;
  totalProductsTracked: number;
  stockStatusCounts: { inStock: number; lowStock: number; outOfStock: number };
  trend: Array<{ date: string; sales: number; purchases: number }>;
  recentPurchases: Purchase[];
  deltas: {
    totalSales: number | null;
    grossProfit: number | null;
    expenses: number | null;
    estimatedNet: number | null;
    totalPurchases: number | null;
  };

  // Profit & Loss at a glance (2026-09-19, CLAUDE.md #69).
  profitAndLoss: {
    yesterday: { grossProfit: number; expenses: number; netProfit: number };
    last7Days: { grossProfit: number; expenses: number; netProfit: number };
  };

  // Outstanding Customer Debt (2026-09-19, CLAUDE.md #69 follow-up) — every
  // COMPLETED sale still carrying a balance (credit sales, CLAUDE.md #50),
  // oldest first. topDebtors is capped (currently 10); debtorCount is the
  // real total count of unpaid sales, which can be larger than the list.
  outstandingDebt: {
    totalOutstanding: number;
    debtorCount: number;
    topDebtors: Array<{
      id: number;
      invoice_number: string;
      sale_date: string;
      customer_name: string | null;
      customer_phone: string | null;
      total: number;
      amount_paid: number;
      balance_due: number;
    }>;
  };
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
  // Audit Log Center (2026-09-12, CLAUDE.md #43) — derived server-side from
  // `action` (a fixed lookup, not stored columns): `feature` groups actions
  // into the page's filter tabs, `status` is 'Warning' only for
  // DISCOUNT_APPLIED_HIGH — every other logged action already succeeded by
  // construction (a failed action is never written to this table).
  feature: string;
  status: 'Success' | 'Warning';
}

export interface AuditLogSummary {
  totalEvents: number;
  uniqueUsers: number;
  differentActions: number;
  latestActivity: { createdAt: string; userName: string | null } | null;
  trend: {
    totalEventsPct: number | null;
    uniqueUsersDelta: number | null;
    differentActionsDelta: number | null;
  };
}

export interface AuditLogListResponse {
  rows: AuditLog[];
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  summary: AuditLogSummary;
}

// New Customers module (2026-09-12, Quotations feature, CLAUDE.md #49) —
// mirrors Supplier's shape closely (the two entities are structurally the
// same on this schema).
export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
}

export interface QuotationItem {
  id: number;
  quotation_id: number;
  product_id: number | null;
  description: string;
  unit: string | null;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
  sort_order: number;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export interface Quotation {
  id: number;
  quotation_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  quotation_date: string;
  valid_until: string | null;
  reference: string | null;
  subtotal: string;
  total_discount: string;
  vat_rate_pct: string;
  vat_amount: string;
  total: string;
  notes: string | null;
  status: QuotationStatus;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  converted_sale_id: number | null;
  // Present on GET /quotations (list) only — the detail endpoint attaches
  // `items` instead (same split as Sale.item_count vs Sale.items).
  item_count?: number;
  items?: QuotationItem[];
}

// Business Settings (2026-09-12, CLAUDE.md #49) — the very first UI for
// business_settings; every field here already existed in the database
// except the bank/VAT/validity ones added alongside Quotations.
export interface BusinessSettings {
  id: number;
  business_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  currency: string;
  default_max_discount_pct: string;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_name: string | null;
  bank_swift: string | null;
  bank_branch: string | null;
  vat_rate_pct: string;
  quotation_validity_days: number;
  // Credit sales (2026-09-12, CLAUDE.md #50) — two mobile money numbers for
  // receiving customer payments, shown next to bank details when a sale
  // still has a balance owed. Free-text label per number (e.g. "M-Pesa",
  // "Tigo Pesa") since this system doesn't hardcode Tanzania's networks.
  mobile_money_1_number: string | null;
  mobile_money_1_label: string | null;
  mobile_money_2_number: string | null;
  mobile_money_2_label: string | null;
  // Standard invoice/quotation Terms text (2026-09-12, CLAUDE.md #54) — a
  // fallback default for the printed Notes/Terms box, set once here
  // instead of retyped on every sale.
  invoice_terms: string | null;
  updated_at: string;
}

export interface ApiErrorShape {
  error: string;
  details?: unknown;
}
