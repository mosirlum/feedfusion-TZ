-- Feed Fusion Tanzania — Migration 010
-- Requested 2026-09-11: a purchase's "additional costs" (transport, loading
-- labour, etc.) should be itemized, not just one lump number, so the owner
-- can see what made up that total later and (eventually) report on it by
-- kind. purchases.additional_costs / purchase_items.allocated_additional_cost
-- stay exactly as they are — this table is a breakdown of that same total,
-- not a second source of truth. See CLAUDE.md "Flagged judgment calls" #15.

CREATE TABLE purchase_additional_cost_lines (
    id            SERIAL PRIMARY KEY,
    purchase_id   INTEGER NOT NULL REFERENCES purchases(id),
    label         VARCHAR(60) NOT NULL,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_additional_cost_lines_purchase_id ON purchase_additional_cost_lines(purchase_id);
