-- Feed Fusion Tanzania — MVP Database Schema
-- PostgreSQL. Forward-only migrations recommended: split this into numbered
-- files under backend/db/migrations/ when you start building.

-- ============================================================
-- USERS & BUSINESS
-- ============================================================

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    email           VARCHAR(160) UNIQUE,
    phone           VARCHAR(30),
    password_hash   TEXT NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'sales', 'manager')),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Added in migration 014 (2026-09-12, CLAUDE.md #47). must_change_password
    -- is set true whenever someone else assigns a temporary password (new
    -- account, or an owner-initiated reset) and cleared once that person sets
    -- their own via POST /auth/change-password. avatar_data_url is a small
    -- data: URL (resized client-side) rather than a file path — no upload
    -- middleware/static-serving exists in this project — NULL means "no
    -- photo, show initials".
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    avatar_data_url TEXT
);

CREATE TABLE business_settings (
    id          SERIAL PRIMARY KEY,
    business_name VARCHAR(160) NOT NULL,
    phone       VARCHAR(30),
    email       VARCHAR(160),
    address     TEXT,
    tin         VARCHAR(50),
    currency    VARCHAR(10) NOT NULL DEFAULT 'TZS',        -- TZS only for MVP, single currency
    default_max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,  -- GLOBAL discount limit, applies to every sales user
    -- Added in migration 017 (2026-09-12, Quotations, CLAUDE.md #49) — bank
    -- details ("namba za malipo") entered once here rather than typed on
    -- every quotation, plus a VAT rate and default quotation validity.
    bank_account_name        VARCHAR(160),
    bank_account_number      VARCHAR(60),
    bank_name                VARCHAR(120),
    bank_swift               VARCHAR(20),
    bank_branch              VARCHAR(120),
    vat_rate_pct             NUMERIC(5,2) NOT NULL DEFAULT 18,
    quotation_validity_days  INTEGER NOT NULL DEFAULT 14,
    -- Added in migration 018 (2026-09-12, credit sales, CLAUDE.md #50) — two
    -- mobile money numbers for receiving customer payments, shown on a
    -- receipt/invoice next to the bank details above when a balance is
    -- still owed. Free-text label per number (e.g. "M-Pesa", "Tigo Pesa")
    -- rather than a hardcoded network list.
    mobile_money_1_number    VARCHAR(20),
    mobile_money_1_label     VARCHAR(40),
    mobile_money_2_number    VARCHAR(20),
    mobile_money_2_label     VARCHAR(40),
    -- Added in migration 019 (2026-09-12, CLAUDE.md #54) — a standard
    -- invoice/quotation Terms note (e.g. "Payment is due in advance...")
    -- set once here instead of retyped on every sale. `sales.notes` and
    -- `quotations.notes` still take priority when actually set on a
    -- specific document; this is only the fallback default.
    invoice_terms            TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- CATALOG
-- ============================================================

CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    parent_id   INTEGER REFERENCES categories(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(160) NOT NULL,
    category_id         INTEGER REFERENCES categories(id),
    unit                VARCHAR(30) NOT NULL,               -- e.g. 'Bag'
    active_price        NUMERIC(14,2),                       -- NULL until first approved proposal
    active_price_source VARCHAR(20) CHECK (active_price_source IN ('OWNER_SET', 'APPROVED_PROPOSAL')),
    price_last_changed_at TIMESTAMPTZ,
    price_last_changed_by INTEGER REFERENCES users(id),
    minimum_stock       INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BR-26/BR-27/BR-28/BR-29: price only changes via an approved proposal
CREATE TABLE price_proposals (
    id                  SERIAL PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(id),
    proposed_price      NUMERIC(14,2) NOT NULL,
    current_active_price NUMERIC(14,2),                      -- snapshot at proposal time
    proposed_by         INTEGER NOT NULL REFERENCES users(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SUPPLIERS & PURCHASES
-- ============================================================

CREATE TABLE suppliers (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(160) NOT NULL,
    phone       VARCHAR(30),
    email       VARCHAR(160),
    address     TEXT,
    notes       TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchases (
    id                  SERIAL PRIMARY KEY,
    supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
    reference_number    VARCHAR(60) UNIQUE NOT NULL,
    purchase_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    additional_costs     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- e.g. transport, allocated below
    total_cost           NUMERIC(14,2) NOT NULL,
    notes                TEXT,
    created_by           INTEGER NOT NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_items (
    id                      SERIAL PRIMARY KEY,
    purchase_id             INTEGER NOT NULL REFERENCES purchases(id),
    product_id              INTEGER NOT NULL REFERENCES products(id),
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost               NUMERIC(14,2) NOT NULL,
    allocated_additional_cost NUMERIC(14,2) NOT NULL DEFAULT 0,  -- transport etc. spread across items
    total_cost              NUMERIC(14,2) NOT NULL              -- (unit_cost * qty) + allocated_additional_cost
);

-- Added in migration 010 (not in the original schema — see CLAUDE.md
-- "Flagged judgment calls" #15): itemizes what makes up a purchase's
-- additional_costs (e.g. "Delivery / Transport": 30000, "Loading Labour":
-- 15000) so the owner can see the breakdown later. additional_costs and
-- allocated_additional_cost above are still the numbers actually used for
-- inventory value/COGS math — this table is a breakdown of that same total,
-- never a second total to add on top of it.
CREATE TABLE purchase_additional_cost_lines (
    id            SERIAL PRIMARY KEY,
    purchase_id   INTEGER NOT NULL REFERENCES purchases(id),
    label         VARCHAR(60) NOT NULL,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE sales (
    id              SERIAL PRIMARY KEY,
    invoice_number   VARCHAR(40) UNIQUE NOT NULL,
    sale_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
    subtotal         NUMERIC(14,2) NOT NULL,
    total_discount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    total            NUMERIC(14,2) NOT NULL,                  -- subtotal - total_discount
    -- Widened in migration 018 (2026-09-12, credit sales, CLAUDE.md #50) from
    -- a single-value 'PAID' CHECK to PAID/PARTIAL — a deposit smaller than
    -- `total` is now allowed (never zero: "no sale with no payment"), and
    -- the remaining balance is collected later via POST /sales/:id/payments.
    -- amount_paid/balance_due are NEVER stored columns — always derived from
    -- SUM(payments.amount) vs. total, same principle as stock (rule #1).
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID', 'PARTIAL')),
    status           VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
    voided_by        INTEGER REFERENCES users(id),
    voided_at        TIMESTAMPTZ,
    void_reason      TEXT,
    served_by        INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- customer_name added by editing this CREATE TABLE directly, before the
    -- standing "every schema change is a new migration file" rule was
    -- adopted (see CLAUDE.md judgment call #1 and bug #48) — documented here
    -- now for completeness; the actual column exists via migration 004 (or
    -- 015's backfill on any database where 004 already ran without it).
    customer_name    VARCHAR(160),
    -- Added in migration 012 (2026-09-11, Change Approval Center) — a sale's
    -- "Edit" action can save these two immediately, no approval needed,
    -- since neither affects money, stock, or a receipt's totals.
    customer_phone   VARCHAR(30),
    notes            TEXT,
    -- Added in migration 018 (2026-09-12, credit sales, CLAUDE.md #50) — full
    -- "Sold To" details, same three fields a Quotation already snapshots;
    -- customer_id is nullable, so a one-off customer never needs saving.
    customer_address VARCHAR(240),
    customer_id      INTEGER REFERENCES customers(id),
    -- Added in migration 014 (2026-09-12, CLAUDE.md #47) — set the first time
    -- this sale's receipt is actually printed (POST /sales/:id/mark-printed),
    -- independent of `status`: a sale is fully COMPLETED the moment it's
    -- rung up either way (BR-04). NULL means never printed; Sales History
    -- flags anything still NULL after 7 days.
    printed_at       TIMESTAMPTZ
);

CREATE TABLE sale_items (
    id                  SERIAL PRIMARY KEY,
    sale_id             INTEGER NOT NULL REFERENCES sales(id),
    product_id          INTEGER NOT NULL REFERENCES products(id),
    unit_price          NUMERIC(14,2) NOT NULL,               -- snapshot, product price unaffected by discount
    unit_cost_snapshot  NUMERIC(14,2) NOT NULL,                -- for accurate historical COGS/profit
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    line_subtotal       NUMERIC(14,2) NOT NULL,                -- unit_price * quantity
    discount_type       VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK (discount_type IN ('NONE', 'FIXED', 'PERCENT')),  -- FIXED = staff types the shilling amount off directly (primary MVP flow); PERCENT = optional, staff types a %
    discount_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,      -- resolved amount, always stored
    line_total           NUMERIC(14,2) NOT NULL,                -- line_subtotal - discount_amount
    discount_reason      TEXT,
    discount_approved_by INTEGER REFERENCES users(id)           -- set only if it exceeded the seller's own limit
);

CREATE TABLE payments (
    id          SERIAL PRIMARY KEY,
    sale_id     INTEGER NOT NULL REFERENCES sales(id),
    amount      NUMERIC(14,2) NOT NULL,
    -- Widened in migration 018 (2026-09-12, credit sales, CLAUDE.md #50) from
    -- cash-only to CASH/BANK_TRANSFER/MOBILE_MONEY. A sale can have more
    -- than one payment row: the deposit collected at completion time, plus
    -- any later top-up(s) toward the balance (POST /sales/:id/payments) —
    -- possibly by a different method than the original deposit.
    method      VARCHAR(20) NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Correcting a mistake on an already-completed sale (migration 012,
-- 2026-09-11) — the Change Approval Center, mirroring purchase_edit_requests
-- above as closely as the two domains allow. Only an existing line's
-- quantity/unit price/discount are editable this way — never which product
-- a line refers to, and never adding/removing a line (still void +
-- re-enter for those). Total and payment amount aren't stored here at all —
-- they're always recomputed from the (possibly edited) line items, exactly
-- like at the point of sale, so there's nothing independent to propose for
-- them. proposed_items is a full snapshot of each touched line's new
-- intended state, e.g.
--   [{"saleItemId": 41, "quantity": 3, "unitPrice": 18000,
--     "discountType": "FIXED", "discountValue": 2000, "discountReason": "..."}]
-- Owner's own edits auto-approve immediately; a sales/manager user's sits
-- PENDING until the owner reviews it — same BR-26/BR-29-style pattern as
-- price proposals and purchase edit requests.
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

-- ============================================================
-- STOCK MOVEMENTS (the single source of truth for quantity)
-- ============================================================

CREATE TABLE stock_movements (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    movement_type   VARCHAR(20) NOT NULL CHECK (movement_type IN
                        ('PURCHASE', 'SALE', 'VOID_REVERSAL', 'ADJUSTMENT', 'COUNT_CORRECTION')),
    quantity        INTEGER NOT NULL,                          -- signed: + in, - out
    reference_type  VARCHAR(30),                                -- 'purchase' | 'sale' | 'stock_adjustment' | 'stock_count'
    reference_id    INTEGER,                                    -- id of the related record
    balance_after    INTEGER NOT NULL,                           -- running balance, for fast history display
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at);

-- ============================================================
-- STOCK COUNTS & ADJUSTMENTS
-- ============================================================

CREATE TABLE stock_counts (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    expected_qty    INTEGER NOT NULL,
    physical_qty    INTEGER NOT NULL,
    difference      INTEGER NOT NULL,                          -- physical - expected
    reason          VARCHAR(40),                                 -- 'Damaged' | 'Missing' | 'Counting correction' | 'Other'
    -- Free-text explanation alongside the reason pill above — added
    -- migration 013 (2026-09-12, Stock Count Center redesign, CLAUDE.md #37)
    notes           TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    counted_by      INTEGER NOT NULL REFERENCES users(id),
    approved_by     INTEGER REFERENCES users(id),
    -- When approved/rejected, separately from created_at (submission time) —
    -- added migration 013, same reason every other approval table has one.
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_adjustments (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    quantity        INTEGER NOT NULL,                          -- signed
    reason          TEXT NOT NULL,
    notes           TEXT,
    created_by      INTEGER NOT NULL REFERENCES users(id),
    approved_by     INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- EXPENSES & CASH
-- ============================================================

CREATE TABLE expenses (
    id              SERIAL PRIMARY KEY,
    category        VARCHAR(60) NOT NULL,
    amount          NUMERIC(14,2) NOT NULL,
    description      TEXT,
    expense_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Added in migration 009 (not in the original spec — see CLAUDE.md
    -- "Flagged judgment calls" #11): classifies WHEN the expense recurs, for
    -- reporting. PER_PURCHASE is for incidental delivery costs NOT already on
    -- a supplier's invoice — invoice transport/freight stays in
    -- purchases.additional_costs, never duplicated here.
    expense_type     VARCHAR(20) NOT NULL DEFAULT 'PERIODIC'
                        CHECK (expense_type IN ('PER_PURCHASE', 'MONTHLY', 'PERIODIC')),
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_counts (
    id              SERIAL PRIMARY KEY,
    count_date      DATE NOT NULL,
    expected_cash    NUMERIC(14,2) NOT NULL,
    actual_cash      NUMERIC(14,2) NOT NULL,
    difference       NUMERIC(14,2) NOT NULL,                    -- actual - expected
    notes            TEXT,
    counted_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT TRAIL
-- ============================================================

CREATE TABLE audit_logs (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      VARCHAR(80) NOT NULL,                          -- e.g. 'SALE_COMPLETED', 'PRICE_APPROVED', 'STOCK_ADJUSTED'
    entity_type VARCHAR(40),
    entity_id   INTEGER,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- ============================================================
-- CUSTOMERS & QUOTATIONS
-- Added in migrations 016/017 (2026-09-12, CLAUDE.md #49) — not in the
-- original spec. A "Ship To" section needed somewhere to pull real
-- customer info from, so a lightweight Customers module was added
-- alongside it (mirrors the `suppliers` table shape).
-- ============================================================

CREATE TABLE customers (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(160) NOT NULL,
    phone       VARCHAR(30),
    email       VARCHAR(160),
    address     TEXT,
    notes       TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_name ON customers (LOWER(name));

-- customer_name/phone/address are a snapshot at creation time (same
-- pattern as sales.customer_name) — editing/deleting the saved customer
-- later never rewrites an already-issued quotation.
CREATE TABLE quotations (
    id                  SERIAL PRIMARY KEY,
    quotation_number    VARCHAR(40) UNIQUE NOT NULL,           -- QTN-<year>-<seq>, same scheme as sales.invoice_number
    customer_id         INTEGER REFERENCES customers(id),
    customer_name       VARCHAR(160) NOT NULL,
    customer_phone      VARCHAR(30),
    customer_address    TEXT,
    quotation_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until         DATE,
    reference           VARCHAR(80),
    subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_discount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    vat_rate_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,       -- snapshot of business_settings.vat_rate_pct
    vat_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    total               NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes               TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED')),
    created_by          INTEGER NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    converted_sale_id   INTEGER REFERENCES sales(id)           -- set together with status='CONVERTED'
);

CREATE TABLE quotation_items (
    id             SERIAL PRIMARY KEY,
    quotation_id   INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    product_id     INTEGER REFERENCES products(id),            -- nullable; description below is the snapshot
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
