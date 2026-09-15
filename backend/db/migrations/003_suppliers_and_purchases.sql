-- Feed Fusion Tanzania — Migration 003
-- Suppliers & purchases. Depends on 001 (users) and 002 (products).

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
    additional_costs     NUMERIC(14,2) NOT NULL DEFAULT 0,
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
    allocated_additional_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_cost              NUMERIC(14,2) NOT NULL
);
