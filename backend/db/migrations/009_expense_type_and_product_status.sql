-- Feed Fusion Tanzania — Migration 009
-- Adds expense classification (per-purchase / monthly / periodic) requested to
-- support Section 24 reporting broken down by expense frequency, and a
-- PATCH-able product status (the column already exists from migration 002 —
-- this migration only adds the expense_type column; no product schema change
-- needed). Additive only, per CLAUDE.md's forward-only migration rule.

ALTER TABLE expenses
    ADD COLUMN expense_type VARCHAR(20) NOT NULL DEFAULT 'PERIODIC'
        CHECK (expense_type IN ('PER_PURCHASE', 'MONTHLY', 'PERIODIC'));

-- PER_PURCHASE  — an incidental cash cost tied to a specific delivery/buy that is
--                 NOT part of the supplier's invoice (e.g. loading labor paid to
--                 the truck crew). Freight/transport that IS part of the
--                 purchase cost still belongs in purchases.additional_costs,
--                 never duplicated here — see expenses.service.ts.
-- MONTHLY       — recurring, roughly-fixed monthly costs (rent, wages).
-- PERIODIC      — occasional/irregular costs (repairs, licence renewals).
