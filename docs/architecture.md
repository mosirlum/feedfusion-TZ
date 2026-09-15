# Architecture — Feed Fusion Tanzania

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript | Fast dev loop, POS screen needs to feel instant |
| Backend | Node.js + Express + TypeScript | Same language both sides, simple to reason about transactions |
| Database | PostgreSQL | Row-level locking for concurrent sales (Section 16), strong transaction guarantees |
| Auth | JWT, short-lived access token + refresh | Stateless, simple role checks in middleware |
| DB access | `pg` (node-postgres) + hand-written SQL, or Knex as a thin query builder | Keeps transaction boundaries explicit — an ORM that hides `BEGIN/COMMIT` is a bad fit for BR-05/BR-06/BR-18/BR-19 |

## Layered structure (backend)

```
routes/          → HTTP endpoint definitions only, no logic
controllers/      → parse request, call a service, shape the response
services/         → ALL business logic and rules live here (BR-01..BR-34)
db/                → SQL queries, transaction helpers
middleware/        → auth, role guard, request validation
```

**Rule of thumb:** if you're tempted to write an `if` statement checking stock, price approval status, or discount limits inside a controller — stop, that belongs in a service. Controllers should be thin enough to read in ten seconds.

## The sale-completion transaction (the most important piece of code in this system)

This must be a single DB transaction, roughly:

```
BEGIN
  SELECT ... FOR UPDATE on each product row being sold   -- lock rows
  validate requested qty <= available qty for each line   -- BR-05, BR-06
  INSERT sale (status = completed, subtotal, total_discount, total)
  INSERT sale_items (unit_price snapshot, discount fields, unit_cost_snapshot)
  INSERT stock_movements (one per product, type = SALE, negative qty)
  INSERT payments
  INSERT audit_logs
COMMIT
```

If any step throws, the transaction rolls back and the sale simply does not exist — never a half-completed sale (BR per Section 15 of the spec). `SELECT ... FOR UPDATE` (or `SERIALIZABLE` isolation with retry) is what actually prevents the two-users-selling-simultaneously overselling scenario in Section 16 — don't rely on an application-level check-then-write without a DB-level lock, it has a race condition.

## Price snapshots

`sale_items.unit_price` and `sale_items.unit_cost_snapshot` are copied at the moment of sale, not looked up live from `products` afterward. Historical sales must not change if the product's price changes later — otherwise past profit reports silently drift.

## Frontend structure

```
pages/         → one per screen: POS, Inventory, Purchases, Dashboard, Reports, Approvals
components/    → shared UI (ProductCard, CartLine, DiscountModal, PinPrompt)
api/           → typed fetch wrappers per resource, no business logic
hooks/         → e.g. useCart, useStockCheck
```

The POS page is the highest-traffic screen and should optimistically update the cart client-side, but the actual "Complete Sale" call is the only place stock is truly committed — the client never assumes success before the server confirms it.

## Environments

- `dev`: local Postgres (Docker or local install), seeded with sample categories/products from the spec's KPC-30/KPC-20 examples
- Migrations applied via plain numbered SQL files in `backend/db/migrations/`, run in order, no down-migrations required for MVP (forward-only, as noted in CLAUDE.md)

## Deferred (not MVP)

Multi-branch, offline-first POS, barcode scanner integration, receipt printer SDK integration (start with browser print / PDF receipt), payment gateway integration (cash only).
