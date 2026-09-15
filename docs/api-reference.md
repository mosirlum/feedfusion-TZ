# API Reference (MVP) — Feed Fusion Tanzania

Base path: `/api/v1`. All routes except `/auth/login` require a valid JWT. Role required is noted per route (`owner`, `sales`, `any`).

## Auth
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | — | returns access + refresh token |
| POST | `/auth/refresh` | any | |
| POST | `/auth/logout` | any | |
| POST | `/auth/change-password` | any | Self-service password change (2026-09-12, CLAUDE.md #47 — not in the original spec). Body: `{ currentPassword, newPassword }`. Used both for the forced first-login/post-reset change (`must_change_password: true`) and a voluntary change from My Profile; always requires the current password. Clears `must_change_password`. `400 PASSWORD_TOO_SHORT` (under 6 chars), `401 CURRENT_PASSWORD_INCORRECT` |

## Users
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/users` | owner | |
| POST | `/users` | owner | create sales/owner account. New accounts are created with `must_change_password: true` (2026-09-12, CLAUDE.md #47) |
| PATCH | `/users/:id` | owner | status, max_discount_pct, role |
| PATCH | `/users/me` | any | Self-service profile (2026-09-12, CLAUDE.md #47 — not in the original spec). Body: any of `{ name?, phone?, email?, avatarDataUrl? }` — only the fields sent are changed. `avatarDataUrl` is a base64 `data:` URL (resized/compressed client-side; this backend has no file-upload middleware, so no separate image endpoint exists). `400 NAME_REQUIRED`/`EMAIL_REQUIRED` if sent empty, `409 EMAIL_ALREADY_IN_USE` |
| DELETE | `/users/:id` | owner | Hard delete (2026-09-12, CLAUDE.md #45). Only succeeds if the user has no recorded activity anywhere (`sales`, `purchases`, `stock_movements`, `audit_logs`, etc. all reference `users(id)` with no `ON DELETE` rule) — otherwise `409 USER_HAS_RELATED_RECORDS`. Deleting your own account returns `400 CANNOT_DELETE_SELF`. Deactivating (`PATCH` with `status: 'inactive'`) remains the only way to remove access from an account that has actually been used. |
| POST | `/users/:id/reset-password` | owner | Owner resets a forgotten password (2026-09-12, CLAUDE.md #47 — not in the original spec). Body: `{ newPassword }` — the owner types a new temporary password, same UX as creating an account. Sets `must_change_password: true` so the person is forced through `/auth/change-password` on next login. `400 PASSWORD_TOO_SHORT` |

## Categories & Products
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/categories` | any | |
| POST | `/categories` | owner | |
| GET | `/products` | any | excludes products with no approved price (BR-27) unless `?include_unpriced=true&role=owner` |
| POST | `/products` | any | creates product, no active price yet |
| PATCH | `/products/:id` | owner | `{ status: 'active'\|'inactive' }` — deactivate/reactivate; never deletes (added in migration 009, not in the original doc — see CLAUDE.md #12) |
| GET | `/products/:id/stock-history` | owner | full movement list, Section 11 |
| GET | `/products/stock-levels` | any | `[{product_id, current_stock}]` — quantity only, no cost/value fields, so it's safe for a `sales` viewer unlike `/inventory` (BR-24 restricts cost, not quantity). Added 2026-09-11 for the New Sale page's stock badges (CLAUDE.md #33, not in the original doc) |

## Change Approval Center

The frontend page at `/approvals` (renamed from `/price-approvals` 2026-09-11, CLAUDE.md #35; redesigned again the same day into a single merged feed, CLAUDE.md #36) consolidates three separate approval queues — price proposals, sale corrections, and purchase corrections — into one owner-only inbox, plus two aggregate endpoints for its stat cards and Recent Activity sidebar. Each queue is still its own set of routes below; nothing about the routes themselves merged, only where the frontend reviews them.

### Summary & Recent Activity (2026-09-11, CLAUDE.md #36 — not in the original spec)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/approvals/summary` | owner | `{ pending: {price, sale, purchase, total}, approvedToday, approvedYesterday, rejectedToday }` — every number a real `COUNT(*) FILTER (...)` across the three tables below, nothing fabricated. No "priority" breakdown — see CLAUDE.md #36 |
| GET | `/approvals/recent-activity?limit=` | owner | the most recently resolved (`APPROVED`/`REJECTED`) requests across all three tables, merged and sorted by `reviewed_at` descending, default `limit=8` |

### Price Proposals
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/products/:id/price-proposals` | any | sales user submits; owner submission auto-approves (see CLAUDE.md assumption) |
| GET | `/price-proposals?status=PENDING` | owner | approval queue. Rows now also include `category_name`, `proposed_by_role`, and `reviewed_by_name` (2026-09-11, CLAUDE.md #36 — previously only the reviewer's id was returned) |
| POST | `/price-proposals/:id/approve` | owner | sets product.active_price, active_price_source=APPROVED_PROPOSAL |
| POST | `/price-proposals/:id/reject` | owner | with optional note |

### Sale Corrections (2026-09-11, migration 012, CLAUDE.md #35 — not in the original spec)
| Method | Path | Role | Notes |
|---|---|---|---|
| PATCH | `/sales/:id` | any (own sales only for a non-owner) | non-financial half of "Edit" — `{ customer_name?, customer_phone?, notes? }`. Saves immediately, no approval; `customer_phone`/`notes` are new columns on `sales`. `409 SALE_VOIDED` if the sale is voided |
| POST | `/sales/:id/edit-requests` | any (own sales only for a non-owner) | financial half — an existing line's quantity/unit price/discount only, never which product a line is, never adding/removing a line. Body: `{ items: [{sale_item_id, quantity, unit_price, discount_type, discount_value, discount_reason}], reason? }` — each entry is a full new-state snapshot of that line, not a partial diff. Owner's own request auto-approves and applies immediately (recomputes subtotal/total_discount/total, adjusts stock by the quantity delta, updates the sale's one `payments` row to match the new total); a non-owner's request requires `reason` and sits `PENDING`. `409 EDIT_WOULD_EXCEED_AVAILABLE_STOCK` if a quantity increase needs more stock than is currently available |
| GET | `/sales/edit-requests?status=` | owner | the approval queue. Each row now also includes `sale_total`, `requested_by_role`, `reviewed_by_name`, and a computed `preview: { oldTotal, newTotal }` (real financial-impact headline, `null` if the source sale/items couldn't be read) (2026-09-11, CLAUDE.md #36) |
| POST | `/sales/edit-requests/:id/approve` | owner | applies the proposed line changes the same way the owner's own auto-apply does |
| POST | `/sales/edit-requests/:id/reject` | owner | leaves the sale unchanged, with optional `notes` |

### Purchase Corrections

Routes unchanged by this redesign — still listed under "Suppliers & Purchases" below (`POST /purchases/:id/edit-requests`, `GET /purchases/edit-requests`, `.../approve`, `.../reject`). Only the frontend's *review* screen for these moved, from a card on the Purchases page to this unified feed (CLAUDE.md #35/#36); *submitting* a correction is still done from the Purchases page itself. `GET /purchases/edit-requests` rows now also include `total_cost`, `requested_by_role`, `reviewed_by_name`, and a computed `preview: { oldTotal, newTotal }`, same as Sale Corrections above (2026-09-11, CLAUDE.md #36).

## Suppliers & Purchases
| Method | Path | Role | Notes |
|---|---|---|---|
| GET / POST | `/suppliers` | owner, sales | opened to `sales` 2026-09-11 — the Purchases form's supplier dropdown + inline "add a new supplier" need this (CLAUDE.md #29). `GET` now also returns each supplier's `total_purchases` (all-time sum), `purchase_count`, and `last_purchase_date` (CLAUDE.md #30, migration-free — computed, not stored) |
| GET | `/suppliers/stats` | owner | powers the redesigned Suppliers page's stat cards, "Purchase Share by Supplier" / "Top Suppliers by Purchase Value" charts, and insights — all real, computed figures (CLAUDE.md #30, not in the original doc) |
| PATCH | `/suppliers/:id` | owner | edit an existing supplier's own name/phone/email/address/notes/status — any field omitted is left unchanged (CLAUDE.md #30, not in the original doc) |
| GET | `/suppliers/:id/purchases` | owner | purchase history per supplier — stays owner-only, only used from the owner-only Suppliers page |
| POST | `/purchases` | owner, sales | opened to `sales` 2026-09-11 (CLAUDE.md #29). Creates purchase + purchase_items + stock_movements (PURCHASE), one transaction. Body may send `additionalCostLines: [{label, amount}]` instead of a flat `additionalCosts` — when sent, the lines' sum IS `additional_costs` (migration 010, CLAUDE.md #15). `referenceNumber` is optional — when blank, a sequential `PO-<year>-0001` is generated server-side (CLAUDE.md #24) |
| GET | `/purchases?limit=` | owner, sales | recent purchases across all suppliers, newest first (migration 010 — not in the original doc) |
| GET | `/purchases/next-reference` | owner, sales | preview of the next auto-generated reference number — not reserved, only a preview (CLAUDE.md #24, not in the original doc) |
| GET | `/purchases/:id` | owner, sales | includes `additional_cost_lines` |
| POST | `/purchases/:id/edit-requests` | owner, sales | correct an already-recorded purchase — quantities, unit costs, and expense amounts only (never supplier/date/which lines exist). Body: `{ items: [{purchaseItemId, quantity, unitCost}], costLines: [{costLineId, amount}], reason? }`. Owner's own request auto-approves and applies immediately; a `sales` user's request requires a non-empty `reason` and sits `PENDING` until the owner reviews it (migration 011, CLAUDE.md #29, not in the original spec) |
| GET | `/purchases/edit-requests?status=` | owner | the approval queue for staff-submitted corrections |
| POST | `/purchases/edit-requests/:id/approve` | owner | applies the proposed changes: re-allocates costs, posts a compensating stock `ADJUSTMENT` for any quantity delta, updates totals |
| POST | `/purchases/edit-requests/:id/reject` | owner | leaves the purchase unchanged, with optional `notes` |

## Sales / POS
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/products/search?q=` | any | for POS product search, active-priced products only |
| GET | `/sales/next-invoice-number` | any | preview of the next auto-generated invoice number (`INV-<year>-0001`, sequential) — not reserved, only a preview, mirroring `/purchases/next-reference`'s pattern (CLAUDE.md #33, not in the original doc) |
| POST | `/sales` | any | **the core transaction** — see architecture.md. Body: line items (product_id, qty, discount), payment amount, payment method, optional customer details. Invoice numbers switched from random-hex to sequential `INV-<year>-<seq>` 2026-09-11 (CLAUDE.md #33); a genuine collision (two sales completed in the same instant) now returns a clean `409` with `{ "error": "INVOICE_NUMBER_COLLISION" }` instead of retrying inside the same transaction. Since 2026-09-12 (credit sales, CLAUDE.md #50), a sale no longer requires full payment: any `payment_amount > 0` completes the sale, with `payment_status` becoming `PARTIAL` when it's less than the total (`400 PAYMENT_AMOUNT_MUST_BE_POSITIVE` if it's ≤0 — "no sale with no payment," the owner's own rule) |
| POST | `/sales/:id/payments` | owner, or sales (own served sales only) | Records a top-up payment against a `PARTIAL` sale's outstanding balance (2026-09-12, credit sales, CLAUDE.md #50) — e.g. a customer who took goods on partial credit paying the rest later, possibly by a different method. Body: `amount` (required, > 0), `method` (`CASH`\|`BANK_TRANSFER`\|`MOBILE_MONEY`). `409 PAYMENT_EXCEEDS_BALANCE` if `amount` is more than the sale's current `balance_due`; flips `payment_status` to `PAID` once the balance reaches zero. Returns the updated sale (with its full `payments[]` array). Uses the same `assertCanTouchSale` permission check as every other per-sale action |
| GET | `/sales/:id` | owner, or sales (own sales only) | |
| GET | `/sales?date=\|from=&to=&served_by=&status=&product_id=&search=` | any | opened beyond owner 2026-09-11 (Sales History redesign, CLAUDE.md #34) — a non-owner requester is scoped to only sales they served, regardless of filters. `date` (single day) still works; `from`/`to` (inclusive range), `status` (`COMPLETED`\|`VOIDED`), `product_id`, and `search` (matches invoice number, customer name, or any product name on the sale) are new. Each row now also includes `item_count` |
| GET | `/sales/stats?from=&to=&served_by=` | any | powers the Sales History stat cards: `totalSales`, `transactionCount`, `itemsSold`, plus each figure's `*ChangePct` vs the immediately preceding period of the same length (`null` if that period had no sales). Computed over `COMPLETED` sales only. `grossProfit`/`grossProfitChangePct` are included only when the requester is `owner` — omitted entirely for a non-owner (BR-24), not just hidden client-side (2026-09-11, CLAUDE.md #34, not in the original doc) |
| POST | `/sales/:id/void` | owner | reverses stock via VOID_REVERSAL movement, status→VOIDED |
| GET | `/sales/:id/receipt` | any | printable invoice payload (rendered by `ReceiptView.tsx`, no PDF generation — the browser's own Print dialog is the PDF path, same as Quotations). Redesigned 2026-09-12 (CLAUDE.md #51) to match the agreed invoice layout — each item in `items[]` now also carries `unit` (the product's unit, e.g. "Bag"/"Kg", already joined server-side but not previously returned), and the response gained `business_tin` and `notes` to back the invoice's Notes/Terms box. `bank_swift` is still returned for API completeness but no longer rendered by the invoice or the Quotation (both dropped the SWIFT line, per the owner's own instruction). `notes` is `sale.notes` (CLAUDE.md #35) if actually set on that sale, **else `business_settings.invoice_terms`** (CLAUDE.md #54) — a standard boilerplate note set once in Settings instead of retyped per sale; `GET /quotations/:id`'s own `notes` field falls back the same way (client-side, using the already-fetched `GET /settings` response) |
| POST | `/sales/:id/mark-printed` | any (own sales only for a non-owner) | Invoice print tracking (2026-09-12, CLAUDE.md #47 — not in the original spec). Sets `sales.printed_at` the first time a receipt is actually printed — idempotent (`COALESCE`, never overwritten by printing again later). Deliberately doesn't touch `status`: a sale is COMPLETED/PAID the moment it's rung up either way (BR-04 unchanged) — this is "track & warn only," not a lifecycle gate. Sales History flags anything COMPLETED and still unprinted after 7 days. |

Sale creation body shape:
```json
{
  "items": [
    {
      "product_id": 12,
      "quantity": 5,
      "discount": { "type": "FIXED", "value": 3000 }
    }
  ],
  "payment_amount": 247000,
  "payment_method": "CASH",
  "customer_name": "Juma Mhando",
  "customer_phone": "0712345678",
  "customer_address": "Kariakoo, Dar es Salaam",
  "customer_id": null
}
```
`payment_method` is one of `CASH`\|`BANK_TRANSFER`\|`MOBILE_MONEY` (2026-09-12, credit sales, CLAUDE.md #50) — defaults to `CASH` if omitted. `customer_name`/`customer_phone`/`customer_address`/`customer_id` are all optional (a walk-in with no details captured still works exactly as before); `customer_id` links a saved Customer the same way Quotations already do (CLAUDE.md #49). The response now also includes `payment_status` (`PAID`\|`PARTIAL`), `amount_paid`, `balance_due` (both derived — never stored — as `SUM(payments.amount)` vs. `total`), and the full `payments[]` array. Discount limit is global (`business_settings.default_max_discount_pct`), not per-user.

**Discount reason and the owner-PIN gate were both removed (2026-09-13, CLAUDE.md #66).** A discount's `reason` is now optional and no longer validated — omit it, or include it, either is accepted. A discount exceeding the global limit no longer requires (or accepts) `discount_pin`, and no longer blocks the sale — `DISCOUNT_APPROVAL_REQUIRED`/`DISCOUNT_PIN_INVALID` no longer exist as response codes. Instead, the sale completes normally and the response carries `highDiscountWarnings: [{ productName, effectivePct, maxPct }]` for any line that exceeded the limit, which the POS shows the cashier as a one-time toast; the same event still writes a `DISCOUNT_APPLIED_HIGH` "Warning" entry to the Audit Log (CLAUDE.md #43), which is now the only after-the-fact record of it.

## Customers & Quotations (2026-09-12, CLAUDE.md #49 — not in the original spec)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/customers` | any | full list, alphabetical |
| GET | `/customers/search?q=` | any | backs the Quotation form's "Ship To" autocomplete — matches name or phone, case-insensitive, capped at 10; empty `q` returns the 10 most recently added active customers instead of nothing |
| POST | `/customers` | any | body: `name` (required), `phone?`, `email?`, `address?`, `notes?`. Phone validated with the same `isValidTzPhone` shape used by Suppliers |
| PATCH | `/customers/:id` | any | any subset of the create fields, plus `status: 'active'\|'inactive'` |
| GET | `/quotations/next-number` | any | preview of the next `QTN-<year>-0001`-style number — not reserved, same pattern as `/sales/next-invoice-number` |
| GET | `/quotations` | any | full list, newest first, with `item_count` and `created_by_name`; not scoped to "own" — a quotation is a shared, customer-facing document, unlike Sales History's profit figures |
| POST | `/quotations` | any | creates a quotation + its items in one transaction. Body: `customerId?` (links a saved customer — its phone/address fill in if not overridden), `customerName` (required), `customerPhone?`, `customerAddress?`, `validUntil?` (defaults to today + `business_settings.quotation_validity_days`), `reference?`, `notes?`, `items: [{ productId, quantity, unitPrice?, discountPct? }]` — every item needs a real `productId` (items are always catalog products, never free-text); `unitPrice` defaults to that product's current `active_price` if omitted. Server computes `subtotal`/`total_discount`/`vat_amount`/`total` — `vat_rate_pct` is a snapshot of `business_settings.vat_rate_pct` at creation time |
| GET | `/quotations/:id` | any | full quotation with its `items` array |
| PATCH | `/quotations/:id/status` | any | body: `status` — one of `DRAFT`\|`SENT`\|`ACCEPTED`\|`REJECTED`\|`EXPIRED` (never `CONVERTED` directly — that's set only by `/convert` below). `400 QUOTATION_ALREADY_CONVERTED` once converted |
| POST | `/quotations/:id/convert` | any | body: `saleId` — links this quotation to an already-completed sale (see "Convert to Sale" flow, CLAUDE.md #49) and sets `status = 'CONVERTED'`. Called by the frontend right after `POST /sales` succeeds from a cart pre-filled from this quotation's items; does no stock/pricing work itself |

## Business Settings (2026-09-12, CLAUDE.md #49 — not in the original spec)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/settings` | any | the single `business_settings` row — open to every role since a printed Quotation's business header/bank details are needed regardless of who's creating it, same as how receipts already show business info to everyone |
| PATCH | `/settings` | owner | any subset of: `businessName`, `phone`, `email`, `address`, `tin`, `currency`, `defaultMaxDiscountPct`, `bankAccountName`, `bankAccountNumber`, `bankName`, `bankSwift`, `bankBranch`, `vatRatePct`, `quotationValidityDays`, `mobileMoney1Number`, `mobileMoney1Label`, `mobileMoney2Number`, `mobileMoney2Label`, `invoiceTerms`. This is the very first route ever calling `businessSettingsRepo.ts`'s `updateBusinessSettings()` — before this feature, the row could only be seeded, never edited from the app. The 4 mobile money fields (2026-09-12, credit sales, CLAUDE.md #50) are free-text, unvalidated against the usual `isValidTzPhone` shape — the owner gave them in international `+255...` display format, not the app's local `0...` format. `invoiceTerms` (2026-09-12, CLAUDE.md #54) is a standard Notes/Terms note printed on every invoice/quotation unless that specific document has its own |

## Inventory & Stock
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/inventory` | owner | current stock, value, status per product, plus `last_movement_at` (2026-09-11 — timestamp of that product's most recent `stock_movements` row, or null) — also consumed by the Products page's stock column/stat cards/alerts (2026-09-11) |
| POST | `/stock-counts` | owner/sales | records expected vs physical. Body now also accepts `notes?` (free text, migration 013, 2026-09-12, CLAUDE.md #37) alongside the existing categorical `reason`. Every submission — including the owner's own — sits `PENDING`; unlike Price Proposals/Sale Corrections/Purchase Corrections, there is no owner-auto-approve path here (confirmed intentional, CLAUDE.md #37) |
| GET | `/stock-counts?status=` | owner | the approval queue — rows now also include `category_name`, `counted_by_role`, and `notes` (2026-09-12, CLAUDE.md #37) |
| GET | `/stock-counts/summary` | owner | Stock Count Center's stat cards (2026-09-12, CLAUDE.md #37, not in the original doc) — `{ pending, pendingVarianceUnits, countedToday, countedYesterday, rejectedToday }`. `pendingVarianceUnits` is `SUM(ABS(difference))` over `PENDING` counts only — current unresolved exposure, not an all-time total (a judgment call, see CLAUDE.md) |
| GET | `/stock-counts/recent-activity?limit=` | owner | Recent Activity sidebar feed (same redesign) — each stock count can produce up to two events (submitted, and separately resolved), sorted together, newest first |
| POST | `/stock-counts/:id/approve` | owner | creates ADJUSTMENT/COUNT_CORRECTION movement; also sets the new `reviewed_at` (migration 013) |
| POST | `/stock-counts/:id/reject` | owner | leaves stock untouched; also sets `reviewed_at` |
| POST | `/stock-adjustments` | owner | direct adjustment (e.g. damaged goods), immediately approved if created by owner. `reason` must now be one of `Damaged`/`Expired`/`Lost`/`Found`/`Correction`/`Other` (2026-09-12, CLAUDE.md #38) — previously any non-empty free text was accepted; `400 INVALID_REASON` otherwise |
| GET | `/stock-adjustments` | owner | full history, most recent first — rows now also include `category_name` and `created_by_role` (2026-09-12, CLAUDE.md #38, not in the original doc) |
| GET | `/stock-adjustments/summary` | owner | Stock Adjustments Center's stat cards (2026-09-12, CLAUDE.md #38, not in the original doc) — `{ adjustmentsToday, adjustmentsYesterday, writtenOffLast7, writtenOffHint, increasedLast7, decreasedLast7 }`. `writtenOffLast7` is a judgment call: sum of *decrease* adjustments reasoned Damaged/Expired/Lost only (excludes Correction and Found) over the trailing 7 days, so it doesn't just duplicate `decreasedLast7` (all decreases, any reason) |

## Cash & Expenses
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/cash-counts` | owner | expected auto-computed from today's sales (or from `countDate` if backdated) |
| GET | `/cash-counts?from=&to=` | owner | historical reconciliation, most recent first (also powers the Cash Control Center's History time-range filter, 2026-09-12, CLAUDE.md #39) |
| GET | `/cash-counts/summary` | owner | Cash Control Center's stat cards (2026-09-12, CLAUDE.md #39, not in the original doc) — `{ expectedCashToday, latestCount, countsThisWeek, pendingToday }`. `latestCount` is the most recently created cash count row (any date), not necessarily today's; `countsThisWeek` counts every row (recounts included) in the current ISO week; `pendingToday` is `1`/`0` for whether today has a row yet — a live check, not a stored status (there's no approval workflow on this table) |
| GET / POST | `/expenses` | owner | body adds `expenseType: 'PER_PURCHASE'\|'MONTHLY'\|'PERIODIC'` (default `PERIODIC`), migration 009 — see CLAUDE.md #11; GET supports `?expense_type=`, `?from=`, `?to=` filters. `category` stays an unconstrained string server-side; the Expenses page redesign (2026-09-12, CLAUDE.md #40) is what adds fixed category lists per type, entirely client-side |

## Dashboard & Reports
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/dashboard/today` | owner | sales, transactions, gross profit, expenses, net, expected cash, alerts, top products. Extended 2026-09-12 (CLAUDE.md #56/#57) with the real aggregates behind the redesigned Dashboard's charts/donuts — `totalPurchasesToday` (sum of `purchases.total_cost` dated today), `currentStockValue` and `totalProductsTracked` (same figures Inventory itself computes, CLAUDE.md #32), `stockStatusCounts: {inStock, lowStock, outOfStock}`, `trend: [{date, sales, purchases}]` for the trailing 7 days (gaps filled with 0, same convention as Reports' daily series), `recentPurchases` (last 5, same shape as `GET /purchases`), and `deltas: {totalSales, grossProfit, expenses, estimatedNet, totalPurchases}` — each a real day-over-day % change vs yesterday, `null` when yesterday had nothing to compare against (never a fabricated 0%/∞%). Also fixed in the same pass: `expectedCash` now uses `salesRepo.sumCashReceivedForDate` (real cash actually received today) instead of the stale `totalSales` figure, which double-counted non-cash and partial/credit sales after CLAUDE.md #50. |
| GET | `/reports/sales?from=&to=` | owner | |
| GET | `/reports/sales-overview?from=&to=` | owner | Reports "Sales" tab redesign (2026-09-12, CLAUDE.md #41, not in the original doc) — one aggregator backing the redesigned Sales tab's stat cards (with real "vs previous period of equal length" trends, same helper as Sales History's — CLAUDE.md #34), a daily chart, two donuts, a Top 5 list, a Cash Count History preview, and the numbers behind "Quick Insights." Returns `{ current: {totalRevenue, transactionCount, totalDiscount, voidedCount}, changePct: {...same 4 keys, each number\|null}, dailySeries: [{date, revenue, transactions, discount, voided}], revenueByCategory: [{category_name, quantity_sold, revenue}], revenueByStaff: [{user_id, user_name, transaction_count, revenue}], topProducts, totalQuantitySold, cashHistory, lowStockCount }`. `revenueByStaff` is a judgment call: the reference mockup's "Sales by Payment Method" donut (Cash/Card/Mobile Money) assumes payment types this system doesn't have (`payments.method` is CHECK-constrained to `'CASH'` only) — confirmed with the owner to replace it with real staff-revenue data instead of a meaningless "100% Cash" slice or dropping the second donut. `changePct` values are `null`, never a fabricated 0%/∞%, when the previous period had no data to compare against. |
| GET | `/reports/products?from=&to=` | owner | per-product revenue/cost/profit — also consumed by the Products page's "Top Selling Products" panel (2026-09-11), scoped to month-to-date |
| GET | `/reports/stock` | owner | |
| GET | `/reports/low-stock` | owner | |
| GET | `/reports/discounts?from=&to=&user_id=` | owner | totals by user/reason, per addendum |
| GET | `/reports/cash?from=&to=` | owner | |
| GET | `/reports/users?from=&to=` | owner | activity comparison, framed as a signal not an accusation per Section 26 |
| GET | `/reports/purchase-costs?from=&to=` | owner | Purchase Costs report (2026-09-12, CLAUDE.md #40, not in the original doc) — `{ purchases, summary: { purchaseCount, totalGoodsValue, totalAdditionalCosts, totalPerPurchaseExpenses, combinedOverhead }, costLinesByLabel, perPurchaseExpenses, perPurchaseByCategory }`. `combinedOverhead` is a judgment call: additional cost lines + `PER_PURCHASE` expenses only, deliberately excluding the goods subtotal itself and never meant to be added into Net Profit a second time (additional costs already reduce gross profit through COGS) |

## Audit
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/audit-logs?entity_type=&entity_id=&from=&to=&user_id=&action=&feature=&page=&page_size=&sort_by=&sort_dir=` | owner | Audit Log Center (2026-09-12, CLAUDE.md #43) — response shape changed from a bare array to `{ rows, pagination: {page, pageSize, totalRows, totalPages}, summary: {totalEvents, uniqueUsers, differentActions, latestActivity, trend: {totalEventsPct, uniqueUsersDelta, differentActionsDelta}} }`. `feature` is one of `Sales/Purchases/Stock/Cash/Expenses/Price Proposals/Products/Others` — a fixed lookup from `action` (see `backend/src/db/auditRepo.ts`'s `FEATURE_ACTIONS`), not a stored column. Each row also carries a derived `status: 'Success' \| 'Warning'` — `'Warning'` only for the new `DISCOUNT_APPLIED_HIGH` action (see below); every other action is `'Success'` since a failed action is never written to `audit_logs` in the first place (it always runs inside the same transaction as the action it records). `sort_by` is one of `created_at/action/user_name/details` (default `created_at`), `sort_dir` is `asc`/`desc` (default `desc`). `trend` is only computed when both `from` and `to` are given, using the same "previous period of equal length" helper as Sales History/Reports. |
