-- Feed Fusion Tanzania — Migration 011
-- Requested 2026-09-11: a way to correct a mistake on an already-recorded
-- purchase. Confirmed with the owner: sales staff now get access to record
-- purchases too, but any edit they make afterward must wait for the owner's
-- approval (with a reason attached); the owner's own edits apply right away,
-- mirroring the existing price-proposal pattern (BR-26/BR-29 — owner
-- submissions auto-approve, a sales user's sits PENDING). Only "the numbers"
-- are editable this way — an existing item's quantity/unit cost, or an
-- existing expense line's amount — never the supplier, date, or which
-- products/lines exist. See CLAUDE.md "Flagged judgment calls" for the full
-- design writeup.
--
-- proposed_items / proposed_cost_lines store what was requested, as JSON —
-- e.g. proposed_items: [{"purchaseItemId": 12, "quantity": 45, "unitCost": 18000}]
-- proposed_cost_lines: [{"costLineId": 3, "amount": 25000}]
-- — a snapshot of the request, not applied to purchases/purchase_items until
-- (and unless) the request is approved.

CREATE TABLE purchase_edit_requests (
    id                  SERIAL PRIMARY KEY,
    purchase_id         INTEGER NOT NULL REFERENCES purchases(id),
    proposed_items      JSONB NOT NULL DEFAULT '[]',
    proposed_cost_lines  JSONB NOT NULL DEFAULT '[]',
    reason              TEXT,
    requested_by        INTEGER NOT NULL REFERENCES users(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_edit_requests_purchase_id ON purchase_edit_requests(purchase_id);
CREATE INDEX idx_purchase_edit_requests_status ON purchase_edit_requests(status);
