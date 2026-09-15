-- Feed Fusion Tanzania — Migration 012
-- Requested 2026-09-11: evolve the old "Price Approvals" page into a
-- Change Approval Center — the owner becomes the gatekeeper for any
-- sensitive edit made to an already-completed sale, not just proposed
-- product prices. Mirrors the purchase_edit_requests pattern (migration
-- 011) as closely as the two domains allow. Confirmed with the owner:
--   - Only an existing line's quantity, unit price, and discount are
--     editable this way — never which product a line refers to (that
--     mistake still means void + re-enter, same as Purchases today), and
--     never adding or removing a line entirely.
--   - Total and payment amount are NOT independent fields — they're always
--     recomputed from the (possibly edited) line items, exactly like at
--     the point of sale. There's nothing to store for them here beyond
--     what proposed_items already implies.
-- See CLAUDE.md "Flagged judgment calls" for the full design writeup.
--
-- proposed_items stores what was requested, as JSON — a full snapshot of
-- each touched line's new intended state (not a partial diff), e.g.
--   [{"saleItemId": 41, "quantity": 3, "unitPrice": 18000,
--     "discountType": "FIXED", "discountValue": 2000, "discountReason": "..."}]
-- — never applied to sales/sale_items until (and unless) approved.

CREATE TABLE sale_edit_requests (
    id              SERIAL PRIMARY KEY,
    sale_id         INTEGER NOT NULL REFERENCES sales(id),
    proposed_items  JSONB NOT NULL DEFAULT '[]',
    reason          TEXT,
    requested_by    INTEGER NOT NULL REFERENCES users(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by     INTEGER REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sale_edit_requests_sale_id ON sale_edit_requests(sale_id);
CREATE INDEX idx_sale_edit_requests_status ON sale_edit_requests(status);

-- Non-financial fields a sale didn't previously carry, so an "Edit" on an
-- already-completed sale has somewhere honest to save customer contact
-- details and a free-text note — these save immediately, no approval,
-- since neither affects money, stock, or the receipt's totals.
ALTER TABLE sales ADD COLUMN customer_phone VARCHAR(30);
ALTER TABLE sales ADD COLUMN notes TEXT;
