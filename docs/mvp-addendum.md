# MVP Addendum — Custom Pricing Approval & Point-of-Sale Discounts

This extends the original MVP spec. It does not replace any section — it adds two new modules and updates the affected business rules, entities, and scenarios.

---

## A. NEW MODULE — Price Proposals (User-Suggested Price, Owner Confirms)

### Why this exists
BR-23 in the original spec says selling prices are controlled by authorized users (the owner). But in practice, a sales user often knows the market price better in the moment (a supplier price changed, a competitor's price changed, a customer negotiates). We don't want to give sales users direct write access to `selling_price` — that breaks BR-23/BR-24 — but we also don't want the owner to be a bottleneck for every product. So this is an **approval queue**, not open editing.

### How it works
1. A sales user (or owner) can submit a **Price Proposal** for a product: new product price, or a change to an existing product's price.
2. The proposal sits as `PENDING`. The product's **active** selling price does not change yet.
3. Owner reviews the queue and either **Approves** (price becomes active, effective immediately) or **Rejects** (with optional note).
4. If approved, the system logs the change to price history and creates an audit entry.
5. If a *new* product has no approved price yet, it **cannot be sold** — it shows as "Awaiting price approval" on the sales screen and is excluded from search results in POS.

### New Entity — `price_proposals`
| Field | Notes |
|---|---|
| id | |
| product_id | |
| proposed_price | |
| current_active_price | snapshot at time of proposal, for comparison |
| proposed_by | user id |
| status | `PENDING` / `APPROVED` / `REJECTED` |
| reviewed_by | owner id, null until reviewed |
| reviewed_at | |
| notes | optional, from proposer and/or owner |
| created_at | |

### Updated Entity — `products`
Add:
- `active_price_source` — `OWNER_SET` or `APPROVED_PROPOSAL`
- `price_last_changed_at`
- `price_last_changed_by`

### New Business Rules
- **BR-26**: A product's active selling price only changes when an owner approves a price proposal (or the owner sets it directly — direct owner edits can be treated as an auto-approved proposal, for audit consistency).
- **BR-27**: A product with no approved price cannot appear as sellable in the POS screen.
- **BR-28**: Every price proposal, approval, and rejection is recorded in the audit trail.
- **BR-29**: A pending proposal does not affect the currently active price — sales continue at the old price until approval.

### New Scenario
**Sales user proposes a price change**
```
Sales user notices supplier increased cost.
Submits proposal: KPC-30, 50,000 → 53,000, note: "supplier cost increase"
        ↓
Status: PENDING
        ↓
Product continues selling at 50,000
        ↓
Owner opens "Price Approvals" queue
        ↓
Owner approves
        ↓
Active price becomes 53,000
        ↓
Audit log: "User A proposed, Owner approved, 50,000→53,000"
```

---

## B. NEW MODULE — Discounts at Point of Sale

### Why this exists
Real transactions negotiate: "5 bags, punguza 3,000." This has to be handled per line item, not as an edit to the product's selling price — the selling price itself (module A above) must stay untouched. A discount is a **transaction-level decision**, not a **product-level price change**.

### How it works
On the sales screen, per line item, the sales user can apply:
- **Fixed amount off** the line total (e.g. "off 3,000 total on this line" — matches your example), or
- **Percentage off** the line total

The unit price shown stays the product's active price. The discount is a separate, visible adjustment on that line and on the receipt — never silently baked into the unit price. This matters for BR-24 (cost/margin visibility control) and for profit reporting: revenue must reflect the *discounted* amount, cost of goods sold is unaffected by the discount, so gross profit drops by exactly the discount amount.

### Discount Authorization Limit (important control)
> **Amended 2026-09-13 (CLAUDE.md #66), at the owner's explicit request — see the note under BR-31/BR-32 below.** The global limit itself stays; the owner-PIN block and the mandatory reason are both gone. The rest of this section is kept as the original MVP framing, for history.

Letting any sales user apply unlimited discounts is the same risk as letting them edit prices. For MVP:
- **One global limit applies to every sales user** (e.g. 5%), set once by the owner in Business Settings — not configured per person. Simpler to build and manage for a small team; can be split per-user later if the business grows and the owner wants to trust some staff with more room than others.
- ~~A discount above that threshold requires **owner/manager approval** via an on-screen PIN entry by the owner at the till (the realistic flow for a small walk-in shop — no remote approval queue needed for MVP).~~ **Removed 2026-09-13** — see BR-32 below.
- ~~Every discount (regardless of size) requires a short reason, and is logged.~~ **Reason requirement removed 2026-09-13** — see BR-31 below. Logging (Audit Log) continues either way.

### Manual Discount Entry (how staff actually apply it)
The primary MVP flow is **staff types the shilling amount off directly** — not a percentage calculator. Example: 5 bags at 10,000 each = 50,000 subtotal; staff types "2,000" into the discount field; system shows the line total as 48,000 automatically. The percentage option exists in the schema (`discount_type = PERCENT`) for cases where a % makes more sense (e.g. bulk-order negotiations), but fixed-amount entry is what the POS screen should default to and optimize for, since that matches how discounts are actually negotiated at the counter.

### Updated Entity — `sale_items`
Add:
| Field | Notes |
|---|---|
| unit_price | unchanged product price, unaffected by discount |
| quantity | |
| line_subtotal | unit_price × quantity |
| discount_type | `NONE` / `FIXED` / `PERCENT` |
| discount_value | e.g. `3000` or `10` |
| discount_amount | resolved amount actually deducted (always stored, even for PERCENT type, so history is stable even if % rules change later) |
| line_total | line_subtotal − discount_amount |
| discount_reason | optional, any size discount (2026-09-13, CLAUDE.md #66 — was "required if discount_type ≠ NONE") |
| discount_approved_by | **No longer set (2026-09-13, CLAUDE.md #66) — always null.** Was: owner id if the discount needed PIN approval. Column kept as-is (no migration) since it's harmless unused history, not because it still means anything. |

### Updated Entity — `sales`
Add:
- `subtotal` — sum of line_subtotals before discount
- `total_discount` — sum of discount_amount across lines
- `total` — subtotal − total_discount (this is what's actually charged, and what Cash Control should expect)

### New Business Rules
- **BR-30**: A discount is applied per line item, as a visible adjustment — never by editing the product's unit price.
- ~~**BR-31**: Every discount requires a reason.~~ **Removed 2026-09-13 (CLAUDE.md #66).** The owner's own reasoning: a discount is self-evidently a discount, and typing a justification for every single one added friction without adding real traceability. A reason can still be typed (the field stays in the UI, just no longer required or enforced), it's just never mandatory.
- ~~**BR-32**: A sales user may apply a discount up to the business's configured global maximum without approval; above that, owner/manager approval (PIN) is required before the sale can complete.~~ **Replaced 2026-09-13 (CLAUDE.md #66).** The global maximum (`business_settings.default_max_discount_pct`) still exists and is still checked — the owner explicitly confirmed the limit itself is a good idea and should stay. What changed: exceeding it no longer blocks the sale on an owner PIN/password (the owner's own words: requiring the PIN "we over do" it). Instead, the sale completes and (a) the cashier sees a one-time warning that the discount exceeded the limit, and (b) it's still recorded as a `DISCOUNT_APPLIED_HIGH` "Warning" entry in the Audit Log — so there's still an after-the-fact record, just no longer a hard gate at the till. **Flagged, not silently decided**: this is a real loosening of an anti-fraud control that CLAUDE.md #7/#43 had deliberately built and reinforced — confirmed explicitly with the owner (including whether to keep the Audit Log entry) before implementing, not inferred.
- **BR-33**: Expected cash, gross profit, and all sales reports must use the discounted total, not the pre-discount subtotal.
- **BR-34**: Cost of goods sold is calculated from actual product cost regardless of discount — discount only reduces revenue, never the recorded cost basis.

### Worked Example (matches yours)
```
KPC-30 × 5 bags @ 50,000 = 250,000 (subtotal)
Discount: fixed 3,000 off this line
Line total: 247,000

Sale has only this one line:
  Subtotal:      250,000
  Total Discount:  3,000
  TOTAL DUE:     247,000

Cost basis (unaffected): 5 × 42,500 = 212,500
Gross profit: 247,000 − 212,500 = 34,500
(vs. 37,500 gross profit if no discount had been given)
```

### Updated Invoice/Receipt Layout
```
KPC-30
5 × 50,000            250,000
Discount               -3,000
                       --------
                        247,000

TOTAL                   247,000
PAID
```

### New Scenario
**Customer negotiates a discount**
```
Customer wants 5 bags KPC-30, asks for discount
        ↓
Sales user adds KPC-30 × 5 to cart
        ↓
Applies discount: 3,000 fixed, reason "customer negotiation"
        ↓
Discount is within user's allowed limit → no approval needed
        ↓
System shows updated total: 247,000
        ↓
Customer pays 247,000
        ↓
COMPLETE SALE
        ↓
Sale recorded with discount_amount = 3,000, discount_reason logged
        ↓
Expected cash for the day includes 247,000, not 250,000
```

**Discount exceeds sales user's limit**
```
Sales user tries to apply 15,000 discount, limit is 10,000
        ↓
System blocks completion, requests owner PIN
        ↓
Owner enters PIN at till → approved
        ↓
Sale completes, discount_approved_by = Owner
```

---

## C. Summary of Additions to Existing Sections

- **Section 4 (Products)**: price field is no longer directly owner-editable in isolation — it's driven by the price-proposal approval flow (Module A). Owner edits are just auto-approved proposals, for a consistent audit trail.
- **Section 13 (Sales/POS)**: line items now carry optional discount fields; totals split into subtotal / discount / total.
- **Section 18 (Invoice/Receipt)**: must show discount line when present.
- **Section 20 (Cash Control)**: expected cash uses post-discount totals.
- **Section 26 (Reports)**: add a **Discounts Report** — total discounts given, by user, by date range, with reasons — so the owner can see if discounting is being overused.
- **Section 28 (Business Rules)**: extended with BR-26 through BR-34 above.
