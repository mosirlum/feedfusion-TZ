-- Feed Fusion Tanzania — Migration 017 (2026-09-12)
-- New Quotations module (CLAUDE.md #49) — the app-side version of the
-- "QUOTATION" Word template delivered earlier: an owner/staff-created
-- document quoting prices to a customer before a sale happens, with a
-- "Convert to Sale" path once the customer accepts.
--
-- customer_name/phone/address are a SNAPSHOT taken at creation time (same
-- pattern as sales.customer_name) — if the saved customer record is edited
-- or deleted later, an already-issued quotation still shows what it showed
-- when printed. customer_id is nullable because a quotation can also be
-- made for a one-off customer that was never saved to the customers table.
CREATE TABLE quotations (
    id                  SERIAL PRIMARY KEY,
    quotation_number    VARCHAR(40) UNIQUE NOT NULL,
    customer_id         INTEGER REFERENCES customers(id),
    customer_name       VARCHAR(160) NOT NULL,
    customer_phone      VARCHAR(30),
    customer_address    TEXT,
    quotation_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until         DATE,
    reference           VARCHAR(80),
    subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_discount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Snapshot of business_settings.vat_rate_pct at creation time — so a
    -- later change to the shop's VAT rate never rewrites an already-issued
    -- quotation's own math.
    vat_rate_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
    vat_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    total               NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes               TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED')),
    created_by          INTEGER NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set once this quotation is turned into a real sale via the "Convert
    -- to Sale" flow (POS pre-filled from this quotation's items) — status
    -- moves to 'CONVERTED' at the same time, in the same request.
    converted_sale_id   INTEGER REFERENCES sales(id)
);

CREATE TABLE quotation_items (
    id             SERIAL PRIMARY KEY,
    quotation_id   INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    -- Nullable + a separate `description` snapshot (not just a join to
    -- products) — same reasoning as purchase/sale items: a product can be
    -- renamed or deactivated later without silently rewriting an
    -- already-issued quotation's line text.
    product_id     INTEGER REFERENCES products(id),
    description    VARCHAR(200) NOT NULL,
    unit           VARCHAR(30),
    quantity       NUMERIC(12,2) NOT NULL,
    unit_price     NUMERIC(14,2) NOT NULL,
    discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
    line_total     NUMERIC(14,2) NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_quotation_items_quotation_id ON quotation_items (quotation_id);
CREATE INDEX idx_quotations_status ON quotations (status);
CREATE INDEX idx_quotations_customer_id ON quotations (customer_id);

-- Business Settings gains the fields a printed Quotation needs that it
-- never had a place to store before this feature: bank/payment details
-- ("namba za malipo") entered once by the owner rather than typed on every
-- quotation, a VAT rate (Tanzania's standard rate, 18%, used as the
-- default — the owner can change it in Settings), and how many days a
-- quotation stays valid by default. None of this existed anywhere in the
-- app before — see CLAUDE.md #49 for why a Settings page is being added in
-- the same pass (updateBusinessSettings() in businessSettingsRepo.ts was
-- entirely dead code until now — no route ever called it).
ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS bank_account_name    VARCHAR(160),
    ADD COLUMN IF NOT EXISTS bank_account_number   VARCHAR(60),
    ADD COLUMN IF NOT EXISTS bank_name             VARCHAR(120),
    ADD COLUMN IF NOT EXISTS bank_swift            VARCHAR(20),
    ADD COLUMN IF NOT EXISTS bank_branch           VARCHAR(120),
    ADD COLUMN IF NOT EXISTS vat_rate_pct           NUMERIC(5,2) NOT NULL DEFAULT 18,
    ADD COLUMN IF NOT EXISTS quotation_validity_days INTEGER NOT NULL DEFAULT 14;
