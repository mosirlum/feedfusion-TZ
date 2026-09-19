import axios, { AxiosError } from 'axios';
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  clearSession,
} from './tokenStore';
import type {
  ApprovalSummary,
  RecentActivityItem,
  AuditLogListResponse,
  BusinessSettings,
  Category,
  Customer,
  DashboardToday,
  Expense,
  ExpenseType,
  PurchaseCostsReport,
  SalesOverviewReport,
  InventoryRow,
  PaymentMethod,
  PriceProposal,
  Product,
  Purchase,
  PurchaseEditRequest,
  ProductSalesRow,
  ProposedSaleItem,
  PublicUser,
  Quotation,
  Sale,
  SaleEditRequest,
  SalesStats,
  StockAdjustment,
  StockAdjustmentsSummary,
  StockCount,
  StockCountSummary,
  StockCountActivityEvent,
  StockLevel,
  StockMovement,
  Supplier,
  SupplierStats,
  UserRole,
} from '../types';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export const http = axios.create({ baseURL });

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
    const accessToken = res.data.accessToken as string;
    setAccessToken(accessToken);
    return accessToken;
  } catch {
    return null;
  }
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const code = (error.response?.data as { error?: string } | undefined)?.error;

    if (error.response?.status === 401 && code === 'TOKEN_EXPIRED' && original && !original._retried) {
      original._retried = true;
      if (!refreshInFlight) {
        refreshInFlight = tryRefresh().finally(() => {
          refreshInFlight = null;
        });
      }
      const newToken = await refreshInFlight;
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return http.request(original);
      }
    }

    if (error.response?.status === 401 && original?.url !== '/auth/login') {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.dispatchEvent(new CustomEvent('ff:session-expired'));
      }
    }

    return Promise.reject(error);
  }
);

export function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    if (data?.error) return humanizeErrorCode(data.error);
    if (err.message === 'Network Error') return 'Cannot reach the server. Is the backend running?';
  }
  return fallback;
}

/**
 * Blob-download error messages (2026-09-13, CLAUDE.md #64) — a real gotcha
 * hit while wiring up the Narrative Report's "Generate Report" button, the
 * first `responseType: 'blob'` call in this file. With `responseType:
 * 'blob'`, axios honors that setting for ERROR responses too (a validation
 * 400 or a server 500 still comes back as a Blob, not parsed JSON), so
 * plain `apiErrorMessage` above would silently read `undefined.error` and
 * always fall back to the generic message, hiding real backend error codes
 * like FROM_AND_TO_DATES_REQUIRED. This reads the Blob as text and parses
 * it as JSON first; every other reportsApi/etc. call keeps using the sync
 * `apiErrorMessage` above unchanged, since only blob-typed calls need this.
 */
export async function apiErrorMessageFromBlob(err: unknown, fallback = 'Something went wrong. Please try again.'): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) return humanizeErrorCode(parsed.error);
      } catch {
        // Not JSON (e.g. an HTML error page from a proxy) — fall through.
      }
    }
    if (err.message === 'Network Error') return 'Cannot reach the server. Is the backend running?';
  }
  return fallback;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ACCOUNT_INACTIVE: 'This account has been deactivated. Contact the owner.',
  INSUFFICIENT_STOCK: 'Not enough stock available for this quantity.',
  PRODUCT_HAS_NO_APPROVED_PRICE: 'This product has no approved selling price yet.',
  DISCOUNT_EXCEEDS_LINE_TOTAL: 'The discount cannot exceed the line total.',
  PAYMENT_AMOUNT_INSUFFICIENT: 'The amount paid is less than the total due.',
  // Credit sales (2026-09-12, CLAUDE.md #50)
  PAYMENT_AMOUNT_MUST_BE_POSITIVE: 'Enter an amount greater than zero.',
  PAYMENT_EXCEEDS_BALANCE: 'That amount is more than the remaining balance on this sale.',
  AMOUNT_REQUIRED: 'Enter an amount.',
  PENDING_PROPOSAL_ALREADY_EXISTS: 'A price proposal is already pending for this product.',
  PROPOSAL_ALREADY_REVIEWED: 'This price proposal has already been reviewed.',
  SALE_ALREADY_VOIDED: 'This sale has already been voided.',
  ADJUSTMENT_WOULD_MAKE_STOCK_NEGATIVE: 'This adjustment would make stock negative.',
  // Stock Adjustments — increase/decrease reason split (2026-09-13, CLAUDE.md #65).
  INVALID_REASON_FOR_DIRECTION: "That reason doesn't apply to this direction — pick one of the reasons shown.",
  STOCK_COUNT_ALREADY_REVIEWED: 'This stock count has already been reviewed.',
  REFERENCE_NUMBER_ALREADY_EXISTS: 'That reference number is already used by another purchase — enter a different one, or leave it blank to auto-generate one.',
  INVALID_PHONE_FORMAT: 'Enter a valid 10-digit Tanzania phone number, e.g. 0712345678.',
  REASON_REQUIRED: 'Please explain why this purchase needs to change.',
  NOTHING_TO_CHANGE: 'Change at least one quantity, cost, or expense amount before submitting.',
  PENDING_EDIT_ALREADY_EXISTS: "There's already a correction on this waiting for the owner's approval.",
  EDIT_WOULD_MAKE_STOCK_NEGATIVE: 'That change would take stock below zero — some of it may already be sold. Double-check the quantity.',
  ITEM_NOT_ON_THIS_PURCHASE: 'That item is not part of this purchase.',
  COST_LINE_NOT_ON_THIS_PURCHASE: 'That expense is not part of this purchase.',
  EDIT_REQUEST_NOT_FOUND: 'This correction request no longer exists.',
  EDIT_REQUEST_ALREADY_REVIEWED: 'This correction has already been reviewed.',
  NAME_REQUIRED: 'A name is required.',
  SUPPLIER_NOT_FOUND: 'This supplier no longer exists.',
  // Customers + Quotations (2026-09-12, CLAUDE.md #49)
  CUSTOMER_NOT_FOUND: 'This customer no longer exists.',
  CUSTOMER_NAME_REQUIRED: 'A customer name is required.',
  INVALID_QUOTATION_ITEM: 'Every item needs a product and a quantity greater than zero.',
  DISCOUNT_PCT_OUT_OF_RANGE: 'Discount must be between 0 and 100%.',
  PRODUCT_NOT_FOUND: 'That product no longer exists.',
  QUOTATION_NOT_FOUND: 'This quotation no longer exists.',
  QUOTATION_NUMBER_COLLISION: 'Another quotation was created at the same moment — please try again.',
  QUOTATION_ALREADY_CONVERTED: 'This quotation has already been converted to a sale.',
  INVALID_QUOTATION_STATUS: 'That is not a valid quotation status.',
  BUSINESS_NAME_REQUIRED: 'Business name is required.',
  VAT_RATE_OUT_OF_RANGE: 'VAT rate must be between 0 and 100%.',
  QUOTATION_VALIDITY_MUST_BE_POSITIVE: 'Validity days must be at least 1.',
  INVOICE_NUMBER_COLLISION: 'Another sale was completed at the same moment — please try again.',
  // Change Approval Center — sale edits (2026-09-11, CLAUDE.md #35)
  SALE_VOIDED: 'This sale has been voided and can no longer be edited.',
  ITEM_NOT_ON_THIS_SALE: 'That item is not part of this sale.',
  EDIT_WOULD_EXCEED_AVAILABLE_STOCK: "That increase needs more stock than's currently available. Double-check the quantity.",
  UNIT_PRICE_MUST_BE_NON_NEGATIVE: 'Unit price cannot be negative.',
  QUANTITY_MUST_BE_POSITIVE: 'Quantity must be greater than zero.',
  // Users — delete (2026-09-12, CLAUDE.md #45)
  CANNOT_DELETE_SELF: "You can't delete your own account.",
  USER_HAS_RELATED_RECORDS:
    'This user has recorded activity in the system (sales, purchases, stock records, audit history, etc.) and cannot be deleted. Deactivate the account instead.',
  // Products — delete (2026-09-19, CLAUDE.md #69)
  PRODUCT_HAS_HISTORY:
    'This product has recorded activity in the system (sales, purchases, stock records, etc.) and cannot be deleted. Deactivate it instead.',
  // Password reset/change + profile self-service (2026-09-12, CLAUDE.md #47)
  PASSWORD_TOO_SHORT: 'Password must be at least 6 characters.',
  CURRENT_PASSWORD_INCORRECT: 'Your current password is incorrect.',
  CURRENT_AND_NEW_PASSWORD_REQUIRED: 'Enter your current password and a new password.',
  NEW_PASSWORD_REQUIRED: 'Enter a new password.',
  EMAIL_REQUIRED: 'Email is required.',
  EMAIL_ALREADY_IN_USE: 'That email is already used by another account.',
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? code.replaceAll('_', ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const authApi = {
  login: (email: string, password: string) =>
    http.post<{ accessToken: string; refreshToken: string; user: PublicUser }>('/auth/login', { email, password }),
  // Self-service password change (2026-09-12, CLAUDE.md #47) — used both for
  // the forced first-login/post-reset change and a voluntary change from My
  // Profile. Requires the current password even right after a forced
  // reset/first-login, since the user just used it to sign in.
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<PublicUser>('/auth/change-password', { currentPassword, newPassword }),
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const usersApi = {
  list: () => http.get<PublicUser[]>('/users'),
  create: (input: { name: string; email: string; password: string; role: UserRole; phone?: string }) =>
    http.post<PublicUser>('/users', input),
  update: (id: number, input: Partial<{ status: 'active' | 'inactive'; role: UserRole }>) =>
    http.patch<PublicUser>(`/users/${id}`, input),
  remove: (id: number) => http.delete<void>(`/users/${id}`),
  // Owner resets someone else's forgotten password (2026-09-12, CLAUDE.md
  // #47) — types a new temporary password; forces a real change on next login.
  resetPassword: (id: number, newPassword: string) =>
    http.post<PublicUser>(`/users/${id}/reset-password`, { newPassword }),
  // Self-service profile — name/phone/email/avatar, own account only.
  updateOwnProfile: (input: Partial<{ name: string; phone: string | null; email: string; avatarDataUrl: string | null }>) =>
    http.patch<PublicUser>('/users/me', input),
};

// ---------------------------------------------------------------------------
// Categories & Products
// ---------------------------------------------------------------------------
export const categoriesApi = {
  list: () => http.get<Category[]>('/categories'),
  create: (input: { name: string; parentId?: number | null }) => http.post<Category>('/categories', input),
};

export const productsApi = {
  list: (includeUnpriced = false) =>
    http.get<Product[]>('/products', { params: includeUnpriced ? { include_unpriced: true, role: 'owner' } : {} }),
  search: (q: string) => http.get<Product[]>('/products/search', { params: { q } }),
  get: (id: number) => http.get<Product>(`/products/${id}`),
  create: (input: { name: string; categoryId?: number | null; unit: string; minimumStock?: number }) =>
    http.post<Product>('/products', input),
  updateStatus: (id: number, status: 'active' | 'inactive') => http.patch<Product>(`/products/${id}`, { status }),
  update: (id: number, patch: { name?: string; categoryId?: number | null; unit?: string; minimumStock?: number }) =>
    http.patch<Product>(`/products/${id}`, patch),
  remove: (id: number) => http.delete<void>(`/products/${id}`),
  stockHistory: (id: number) => http.get<{ product: Product; movements: StockMovement[] }>(`/products/${id}/stock-history`),
  submitProposal: (id: number, input: { proposedPrice: number; notes?: string }) =>
    http.post<PriceProposal>(`/products/${id}/price-proposals`, input),
  // Quantity only, no cost — any role can call this (2026-09-11, New Sale
  // page), unlike inventoryApi.get() which is owner-only.
  stockLevels: () => http.get<StockLevel[]>('/products/stock-levels'),
};

export const priceProposalsApi = {
  list: (status?: string) => http.get<PriceProposal[]>('/price-proposals', { params: status ? { status } : {} }),
  // Approving actually does flip the product's live active_price immediately
  // (sales.service.ts's setProductActivePrice, same transaction as the
  // proposal's own status update) — it always has. But the response body was
  // typed as just `PriceProposal`, so the `product` the backend already
  // returns alongside it (2026-09-13, CLAUDE.md #67) was silently discarded,
  // and the UI never told the owner what the new price actually was — which
  // read as "nothing happened," prompting him to re-set it manually (which,
  // since he's the owner, immediately re-applied anyway, masking the real
  // problem). Typed correctly now so the caller can show the real new price.
  approve: (id: number, notes?: string) =>
    http.post<{ proposal: PriceProposal; product: Product }>(`/price-proposals/${id}/approve`, { notes }),
  reject: (id: number, notes?: string) => http.post<PriceProposal>(`/price-proposals/${id}/reject`, { notes }),
};

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — aggregates
// across price proposals + sale/purchase edit requests; owner-only, same
// access as each individual queue.
export const approvalsApi = {
  summary: () => http.get<ApprovalSummary>('/approvals/summary'),
  recentActivity: (limit = 8) => http.get<RecentActivityItem[]>('/approvals/recent-activity', { params: { limit } }),
};

// ---------------------------------------------------------------------------
// Suppliers & Purchases
// ---------------------------------------------------------------------------
export const suppliersApi = {
  list: () => http.get<Supplier[]>('/suppliers'),
  create: (input: { name: string; phone?: string; email?: string; address?: string; notes?: string }) =>
    http.post<Supplier>('/suppliers', input),
  update: (
    id: number,
    input: Partial<{ name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; status: 'active' | 'inactive' }>
  ) => http.patch<Supplier>(`/suppliers/${id}`, input),
  purchases: (id: number) => http.get<Purchase[]>(`/suppliers/${id}/purchases`),
  stats: () => http.get<SupplierStats>('/suppliers/stats'),
};

export const purchasesApi = {
  create: (input: {
    supplierId: number;
    referenceNumber?: string;
    purchaseDate?: string;
    additionalCosts?: number;
    additionalCostLines?: Array<{ label: string; amount: number }>;
    notes?: string;
    documentDataUrl?: string | null;
    items: Array<{ productId: number; quantity: number; unitCost: number }>;
  }) => http.post<Purchase>('/purchases', input),
  get: (id: number) => http.get<Purchase>(`/purchases/${id}`),
  list: () => http.get<Purchase[]>('/purchases'),
  // Preview-only — not reserved, so the real one assigned on create can
  // differ if another purchase is recorded first.
  nextReference: () => http.get<{ referenceNumber: string }>('/purchases/next-reference'),
  // Correcting a mistake on an already-recorded purchase (2026-09-11) — the
  // owner's own request applies immediately; a sales user's sits PENDING.
  requestEdit: (
    purchaseId: number,
    input: {
      items: Array<{ purchaseItemId: number; quantity: number; unitCost: number }>;
      costLines: Array<{ costLineId: number; amount: number }>;
      reason?: string;
    }
  ) => http.post<{ editRequest: PurchaseEditRequest; purchase: Purchase }>(`/purchases/${purchaseId}/edit-requests`, input),
  listEditRequests: (status?: string) =>
    http.get<PurchaseEditRequest[]>('/purchases/edit-requests', { params: status ? { status } : {} }),
  approveEditRequest: (id: number, notes?: string) =>
    http.post<{ editRequest: PurchaseEditRequest; purchase: Purchase }>(`/purchases/edit-requests/${id}/approve`, { notes }),
  rejectEditRequest: (id: number, notes?: string) =>
    http.post<PurchaseEditRequest>(`/purchases/edit-requests/${id}/reject`, { notes }),
};

// ---------------------------------------------------------------------------
// Sales / POS
// ---------------------------------------------------------------------------
export const salesApi = {
  complete: (input: {
    items: Array<{
      product_id: number;
      quantity: number;
      discount?: { type: 'FIXED' | 'PERCENT'; value: number; reason?: string };
    }>;
    payment_amount: number;
    // Credit sales (2026-09-12, CLAUDE.md #50) — payment_method defaults to
    // CASH server-side if omitted; customer_phone/address/id are the new
    // "Sold To" fields (customer_name already existed).
    payment_method?: PaymentMethod;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_address?: string | null;
    customer_id?: number | null;
  }) => http.post<Sale>('/sales', input),
  // Top up a PARTIAL sale's remaining balance later (2026-09-12, CLAUDE.md
  // #50) — "mzigo unatoka sasa, malipo yanakuja baadaye."
  recordPayment: (id: number, input: { amount: number; method: PaymentMethod }) =>
    http.post<Sale>(`/sales/${id}/payments`, input),
  get: (id: number) => http.get<Sale>(`/sales/${id}`),
  list: (params: {
    from?: string;
    to?: string;
    served_by?: number;
    status?: 'COMPLETED' | 'VOIDED';
    product_id?: number;
    search?: string;
  }) => http.get<Sale[]>('/sales', { params }),
  // Stat cards + "vs previous period" (2026-09-11, Sales History redesign)
  // — grossProfit/grossProfitChangePct are simply absent from the response
  // for a non-owner requester (BR-24, server-side), not hidden client-side.
  stats: (params: { from: string; to: string; served_by?: number }) => http.get<SalesStats>('/sales/stats', { params }),
  void: (id: number, reason: string) => http.post<Sale>(`/sales/${id}/void`, { reason }),
  receipt: (id: number) => http.get(`/sales/${id}/receipt`),
  // Preview-only, like Purchases' equivalent — not reserved, so the real
  // one assigned on completion can differ if another sale finishes first.
  nextInvoiceNumber: () => http.get<{ invoiceNumber: string }>('/sales/next-invoice-number'),
  // Change Approval Center (2026-09-11, CLAUDE.md #35) — the non-financial
  // half of "Edit": saves immediately, no approval.
  update: (id: number, input: { customer_name?: string | null; customer_phone?: string | null; notes?: string | null }) =>
    http.patch<Sale>(`/sales/${id}`, input),
  // The financial half — an existing line's quantity/unit price/discount
  // never change the sale directly; the owner's own request auto-approves,
  // a sales/manager user's sits PENDING until reviewed.
  requestEdit: (saleId: number, input: { items: ProposedSaleItem[]; reason?: string }) =>
    http.post<{ editRequest: SaleEditRequest; sale: Sale }>(`/sales/${saleId}/edit-requests`, input),
  listEditRequests: (status?: string) =>
    http.get<SaleEditRequest[]>('/sales/edit-requests', { params: status ? { status } : {} }),
  approveEditRequest: (id: number, notes?: string) =>
    http.post<{ editRequest: SaleEditRequest; sale: Sale }>(`/sales/edit-requests/${id}/approve`, { notes }),
  rejectEditRequest: (id: number, notes?: string) =>
    http.post<SaleEditRequest>(`/sales/edit-requests/${id}/reject`, { notes }),
  // Invoice print tracking (2026-09-12, CLAUDE.md #47) — call right before
  // window.print() fires, from either the POS "Sale Complete" modal or Sales
  // History's own print button. Idempotent — safe to call on every print.
  markPrinted: (id: number) => http.post<Sale>(`/sales/${id}/mark-printed`),
};

// ---------------------------------------------------------------------------
// Inventory / Stock
// ---------------------------------------------------------------------------
export const inventoryApi = {
  get: () => http.get<InventoryRow[]>('/inventory'),
};

export const stockCountsApi = {
  record: (input: { productId: number; physicalQty: number; reason: string; notes?: string }) =>
    http.post<StockCount>('/stock-counts', input),
  approve: (id: number) => http.post<StockCount>(`/stock-counts/${id}/approve`),
  reject: (id: number) => http.post<StockCount>(`/stock-counts/${id}/reject`),
  list: () => http.get<StockCount[]>('/stock-counts'),
  // Stock Count Center redesign (2026-09-12, CLAUDE.md #37) — owner-only,
  // same access as the review queue itself.
  summary: () => http.get<StockCountSummary>('/stock-counts/summary'),
  recentActivity: (limit = 8) =>
    http.get<StockCountActivityEvent[]>('/stock-counts/recent-activity', { params: { limit } }),
};

export const stockAdjustmentsApi = {
  create: (input: { productId: number; quantity: number; reason: string; notes?: string }) =>
    http.post<StockAdjustment>('/stock-adjustments', input),
  list: () => http.get<StockAdjustment[]>('/stock-adjustments'),
  // Stock Adjustments Center redesign (2026-09-12, CLAUDE.md #38).
  summary: () => http.get<StockAdjustmentsSummary>('/stock-adjustments/summary'),
};

// ---------------------------------------------------------------------------
// Expenses & Cash
// ---------------------------------------------------------------------------
export const expensesApi = {
  list: (params: { from?: string; to?: string; expense_type?: ExpenseType } = {}) =>
    http.get<Expense[]>('/expenses', { params }),
  create: (input: {
    category: string;
    amount: number;
    description?: string;
    expenseDate?: string;
    expenseType: ExpenseType;
  }) => http.post<Expense>('/expenses', input),
};

// ---------------------------------------------------------------------------
// Dashboard, Reports, Audit
// ---------------------------------------------------------------------------
export const dashboardApi = {
  today: () => http.get<DashboardToday>('/dashboard/today'),
  // Custom-range Profit & Loss (2026-09-19, CLAUDE.md #69 follow-up) — the
  // dashboard's hidden-by-default "Custom range" button.
  profitAndLoss: (from: string, to: string) =>
    http.get<{ from: string; to: string; grossProfit: number; expenses: number; netProfit: number }>(
      '/dashboard/profit-and-loss',
      { params: { from, to } }
    ),
};

export const reportsApi = {
  // Reports "Sales" tab redesign (2026-09-12, CLAUDE.md #41).
  salesOverview: (from: string, to: string) =>
    http.get<SalesOverviewReport>('/reports/sales-overview', { params: { from, to } }),
  sales: (from: string, to: string) => http.get('/reports/sales', { params: { from, to } }),
  products: (from: string, to: string) => http.get<ProductSalesRow[]>('/reports/products', { params: { from, to } }),
  stock: () => http.get<InventoryRow[]>('/reports/stock'),
  lowStock: () => http.get<InventoryRow[]>('/reports/low-stock'),
  discounts: (from: string, to: string, userId?: number) =>
    http.get('/reports/discounts', { params: { from, to, user_id: userId } }),
  users: (from: string, to: string) => http.get('/reports/users', { params: { from, to } }),
  // Purchase Costs report (2026-09-12, CLAUDE.md #40).
  purchaseCosts: (from: string, to: string) =>
    http.get<PurchaseCostsReport>('/reports/purchase-costs', { params: { from, to } }),
  // Narrative Business Report (2026-09-13, CLAUDE.md #64) — a real,
  // rule-based written report (intro, narrative, graphs, insights), not a
  // print of the dashboard (see ReportsPage.tsx's "Generate Report"
  // button). The only binary/blob download in this file — every other
  // reportsApi call gets JSON back, this one gets a PDF file, so it needs
  // `responseType: 'blob'` where the others don't.
  narrativePdf: (from: string, to: string) => http.get('/reports/narrative', { params: { from, to }, responseType: 'blob' }),
  // Sales Excel Report (2026-09-14, CLAUDE.md #68e) — replaces the Sales
  // tab's plain client-side CSV download with a real, colored, formula-
  // driven .xlsx built server-side. Blob response, same as narrativePdf.
  salesExcel: (from: string, to: string) => http.get('/reports/sales-excel', { params: { from, to }, responseType: 'blob' }),
};

// ---------------------------------------------------------------------------
// Customers & Quotations (2026-09-12, CLAUDE.md #49)
// ---------------------------------------------------------------------------
export const customersApi = {
  list: () => http.get<Customer[]>('/customers'),
  // Backs the Quotation form's "Ship To" autocomplete — empty q returns
  // the most recently added customers.
  search: (q: string) => http.get<Customer[]>('/customers/search', { params: { q } }),
  create: (input: { name: string; phone?: string; email?: string; address?: string; notes?: string }) =>
    http.post<Customer>('/customers', input),
  update: (
    id: number,
    input: Partial<{ name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; status: 'active' | 'inactive' }>
  ) => http.patch<Customer>(`/customers/${id}`, input),
};

export const quotationsApi = {
  nextNumber: () => http.get<{ quotationNumber: string }>('/quotations/next-number'),
  list: () => http.get<Quotation[]>('/quotations'),
  get: (id: number) => http.get<Quotation>(`/quotations/${id}`),
  create: (input: {
    customerId?: number | null;
    customerName: string;
    customerPhone?: string | null;
    customerAddress?: string | null;
    validUntil?: string | null;
    reference?: string | null;
    notes?: string | null;
    items: Array<{ productId: number; quantity: number; unitPrice?: number; discountPct?: number }>;
  }) => http.post<Quotation>('/quotations', input),
  updateStatus: (id: number, status: Exclude<Quotation['status'], 'CONVERTED'>) =>
    http.patch<Quotation>(`/quotations/${id}/status`, { status }),
  // Called right after POS completes the real sale pre-filled from this
  // quotation's items (see PosPage.tsx) — links the two records.
  convert: (id: number, saleId: number) => http.post<Quotation>(`/quotations/${id}/convert`, { saleId }),
};

// ---------------------------------------------------------------------------
// Business Settings (2026-09-12, CLAUDE.md #49)
// ---------------------------------------------------------------------------
export const settingsApi = {
  get: () => http.get<BusinessSettings>('/settings'),
  update: (
    input: Partial<{
      businessName: string;
      phone: string;
      email: string;
      address: string;
      tin: string;
      currency: string;
      defaultMaxDiscountPct: number;
      bankAccountName: string;
      bankAccountNumber: string;
      bankName: string;
      bankSwift: string;
      bankBranch: string;
      vatRatePct: number;
      quotationValidityDays: number;
      mobileMoney1Number: string;
      mobileMoney1Label: string;
      mobileMoney2Number: string;
      mobileMoney2Label: string;
      invoiceTerms: string;
    }>
  ) => http.patch<BusinessSettings>('/settings', input),
};

export const auditLogsApi = {
  // Audit Log Center (2026-09-12, CLAUDE.md #43) — the endpoint now returns
  // {rows, pagination, summary} instead of a bare array, with real
  // date-range/user/action/feature filters and pagination.
  list: (
    params: {
      entity_type?: string;
      entity_id?: number;
      from?: string;
      to?: string;
      user_id?: number;
      action?: string;
      feature?: string;
      page?: number;
      page_size?: number;
      sort_by?: string;
      sort_dir?: 'asc' | 'desc';
    } = {}
  ) => http.get<AuditLogListResponse>('/audit-logs', { params }),
};
