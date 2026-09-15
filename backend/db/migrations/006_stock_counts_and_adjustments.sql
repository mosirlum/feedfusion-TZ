-- Feed Fusion Tanzania — Migration 006
-- Stock counts & manual adjustments. Depends on 001, 002.

CREATE TABLE stock_counts (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    expected_qty    INTEGER NOT NULL,
    physical_qty    INTEGER NOT NULL,
    difference      INTEGER NOT NULL,
    reason          VARCHAR(40),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    counted_by      INTEGER NOT NULL REFERENCES users(id),
    approved_by     INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_adjustments (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    quantity        INTEGER NOT NULL,
    reason          TEXT NOT NULL,
    notes           TEXT,
    created_by      INTEGER NOT NULL REFERENCES users(id),
    approved_by     INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
