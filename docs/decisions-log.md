# Decisions Log — Feed Fusion Tanzania

Running record of decisions made outside the main spec docs, so nothing discussed gets lost or silently reversed later. Add to this whenever a new decision is made; don't delete old entries.

| # | Decision | Detail | Affects |
|---|---|---|---|
| 1 | Currency | TZS only for MVP. No multi-currency support. | `business_settings.currency` |
| 2 | Product pricing control | Sales staff can propose a price; owner must approve before it becomes active. Owner's own edits are auto-approved (skip the queue). | `price_proposals`, `products` |
| 3 | Discounts exist at the sale line-item level | Never edit the product's price — apply a visible discount on top of it. | `sale_items` |
| 4 | Discount authorization limit is global | ~~One limit (e.g. 5%) set once in Business Settings, applies to every sales user — not configured per person. Above the limit needs owner PIN approval at the till.~~ **Superseded by #9 below (2026-09-13).** | `business_settings.default_max_discount_pct` |
| 5 | Discount entry is a manual amount, not a calculator | Staff types the shilling amount off (e.g. "2,000"), not a formula. System computes the new total automatically. Percentage entry exists as a secondary option, not the default. | POS screen, `sale_items.discount_type` |
| 6 | Receipts print on A4 | Not a thermal/narrow receipt printer. Full-page layout designed accordingly — see `receipt-template.html`. | Frontend print view |
| 7 | Receipt vs. formal invoice are two different documents | The uploaded branded invoice (Bill To, bank transfer details, "Due on Receipt") is for wholesale/B2B orders — a separate template, not yet built. The POS receipt (this project's MVP) is for walk-in cash sales: no Bill To required, no credit terms, shows PAID/CASH. | Future: `docs/wholesale-invoice-template.html` (not built yet) |
| 8 | Customer name is optional on a sale | Defaults to "Walk-in customer." Never required to complete a sale. | `sales` (no mandatory customer field) |
| 9 | Discount reason no longer required; over-limit discount no longer needs owner PIN (supersedes #4) | The global discount limit itself stays (still checked, still configured the same way). What changed, at the owner's explicit request (CLAUDE.md #66): (a) a discount no longer requires a typed reason — his reasoning, a discount is self-evidently a discount; (b) exceeding the limit no longer blocks the sale on the owner's password — instead the sale completes, the cashier sees a one-time warning, and it's still recorded as a `DISCOUNT_APPLIED_HIGH` Warning entry in the Audit Log, so there's still an after-the-fact record even without the PIN gate. | `backend/src/services/sales.service.ts`, `PosPage.tsx`, `EditSaleModal.tsx` |

| 10 | "Remember me" on login controls session storage, not session length | Checked (default): session lives in `localStorage`, stays signed in indefinitely — the app's original, only behavior. Unchecked: session lives in `sessionStorage` instead, and clears itself the moment the browser tab/window closes. No separate "expire after N days" timer either way — this is purely about surviving a closed browser, not a shorter-lived token. | `frontend/src/lib/tokenStore.ts`, `LoginPage.tsx` |

## Still open / not yet decided

- Wholesale/B2B invoice template (item 7) — not built. Revisit when the business actually needs to issue formal supplier-style invoices to bulk customers.
- Manager role — deferred, owner + sales only for MVP.
- Payment methods beyond cash — deferred.
