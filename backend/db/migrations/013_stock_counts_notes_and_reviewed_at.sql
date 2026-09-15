-- Stock Count Center redesign (2026-09-12, CLAUDE.md #37) — the owner's own
-- reference mockup shows a "Reason for count difference" pill (the existing
-- `reason` enum column) AND a separate free-text "Notes / Explanation" box.
-- `stock_counts` only ever had `reason`, so `notes` is new here, the same
-- way sale_edit_requests gained customer_phone/notes for a near-identical
-- reason (CLAUDE.md #35).
--
-- `reviewed_at` is also new — every other approve/reject table in this app
-- (price_proposals, sale_edit_requests, purchase_edit_requests) records
-- when a request was reviewed, separately from when it was submitted
-- (created_at). stock_counts never had this, so there was no honest way to
-- show "approved 2 hours ago" in a Recent Activity feed — only "submitted
-- 2 hours ago," even for a count that was reviewed much later.
ALTER TABLE stock_counts ADD COLUMN notes TEXT;
ALTER TABLE stock_counts ADD COLUMN reviewed_at TIMESTAMPTZ;
