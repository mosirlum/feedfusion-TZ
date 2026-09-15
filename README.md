# Feed Fusion Tanzania — Sales, Inventory & Business Control System

A POS/inventory system for a physical feed shop: track suppliers → stock in → walk-in sales → cash reconciliation → profit reporting, with strict controls on stock accuracy, pricing, and discounts.

## Start here

1. `CLAUDE.md` — read this first, every session. It's the project's persistent memory: rules, conventions, structure.
2. `docs/mvp-spec.md` — the full functional spec and business rules (BR-01–BR-25).
3. `docs/mvp-addendum.md` — price-approval workflow and point-of-sale discounts (BR-26–BR-34).
4. `docs/architecture.md` — stack choices and the sale-completion transaction design.
5. `docs/database-schema.sql` — full schema, ready to run as migrations.
6. `docs/api-reference.md` — endpoint list to build the backend against.
7. `docs/receipt-template.html` — actual printable A4 receipt markup, agreed design.
8. `docs/decisions-log.md` — every decision made outside the main spec, kept current.

## Working with Claude Code on this repo

- `CLAUDE.md` is kept in the repo root on purpose — Claude Code reads it automatically at session start. Update it whenever a real decision is made (don't let it drift from what the code actually does).
- **Suggested parallel-session split**, since these touch mostly separate code paths:
  - Session A: `auth` + `users`
  - Session B: `categories` + `products` + `price-proposals`
  - Session C: `suppliers` + `purchases`
  - Session D: `sales/POS` (highest-risk, touches stock + pricing + discounts — build after B and C have working APIs to call)
  - Session E: `cash` + `expenses` + `reports` + `dashboard`
- Avoid running a session on `sales/POS` at the same time as a session on `stock_movements` or `stock_adjustments` — they share the same table and will conflict.
- Ask Claude to re-read the relevant `docs/` file before implementing anything touching stock, pricing, or discounts — don't rely on it recalling earlier chat.

## Status

Full MVP built: backend (all modules — auth, users, categories/products/price-proposals, suppliers/purchases, sales/POS, inventory, stock counts/adjustments, expenses/cash, dashboard/reports, audit log) and a complete branded frontend covering every screen. See `CLAUDE.md`'s "Commands" section for exact setup steps, and its "Flagged judgment calls & deviations" section for the handful of places the docs were ambiguous or (in one case) inconsistent with each other.

## Quick start

```
# backend
cd backend && cp .env.example .env && cp .env.example .env.test
npm install && npm run migrate && npm run seed && npm run dev

# frontend (separate terminal)
cd frontend && cp .env.example .env
npm install && npm run dev
```

`npm run seed` prints an owner and a sales login to the console — use those to sign in at `http://localhost:5173`.
