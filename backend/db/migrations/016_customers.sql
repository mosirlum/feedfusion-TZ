-- Feed Fusion Tanzania — Migration 016 (2026-09-12)
-- New Customers module (CLAUDE.md #49) — a lightweight, reusable customer
-- record so the Quotation feature's "Ship To" section can be filled from a
-- saved customer instead of retyped every time. Mirrors the `suppliers`
-- table shape exactly (name/phone/email/address/notes/status) for
-- consistency with the rest of the schema — see CLAUDE.md for why no
-- fields beyond that were added (e.g. no separate billing address, no TIN).
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

-- Powers the "type a name, see matching saved customers" autocomplete on
-- the Quotation form (and the Customers page's own search box).
CREATE INDEX idx_customers_name ON customers (LOWER(name));
