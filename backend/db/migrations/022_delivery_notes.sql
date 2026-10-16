-- Feed Fusion Tanzania — Migration 022 (2026-10-16)
-- New Delivery Notes module. A Delivery Note is a standalone, printable
-- document handed to a customer when goods leave the shop — it does NOT
-- depend on a completed sale (owner's client: staff must be able to issue
-- one before/without the sale being completed) and it NEVER touches stock:
-- stock only moves when the real sale completes, as before.
--
-- customer_* are a SNAPSHOT at creation time (same pattern as quotations).
-- linked_sale_id is optional and can be set at creation or afterwards, so a
-- Delivery Note can later be tied to the sale that eventually covers it.
-- Quantities only — deliberately no prices on this document.
CREATE TABLE delivery_notes (
    id                  SERIAL PRIMARY KEY,
    delivery_note_number VARCHAR(40) UNIQUE NOT NULL,
    customer_id         INTEGER REFERENCES customers(id),
    customer_name       VARCHAR(160) NOT NULL,
    customer_phone      VARCHAR(30),
    delivery_address    TEXT,
    delivery_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    driver_name         VARCHAR(120),
    vehicle_number      VARCHAR(40),
    reference           VARCHAR(80),
    notes               TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'ISSUED'
                          CHECK (status IN ('ISSUED', 'DELIVERED', 'CANCELLED')),
    linked_sale_id      INTEGER REFERENCES sales(id),
    created_by          INTEGER NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_note_items (
    id                  SERIAL PRIMARY KEY,
    delivery_note_id    INTEGER NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    product_id          INTEGER REFERENCES products(id),
    description         VARCHAR(200) NOT NULL,
    unit                VARCHAR(30),
    quantity            NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    sort_order          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_delivery_note_items_dn_id ON delivery_note_items (delivery_note_id);
CREATE INDEX idx_delivery_notes_status ON delivery_notes (status);
CREATE INDEX idx_delivery_notes_customer_id ON delivery_notes (customer_id);
CREATE INDEX idx_delivery_notes_linked_sale ON delivery_notes (linked_sale_id);
