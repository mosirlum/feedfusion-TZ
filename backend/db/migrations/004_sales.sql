-- Feed Fusion Tanzania — Migration 004
-- Sales, sale line items, payments. Depends on 001 (users) and 002 (products).

CREATE TABLE sales (
    id              SERIAL PRIMARY KEY,
    invoice_number   VARCHAR(40) UNIQUE NOT NULL,
    sale_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
    subtotal         NUMERIC(14,2) NOT NULL,
    total_discount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    total            NUMERIC(14,2) NOT NULL,
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'PAID' CHECK (payment_status = 'PAID'),
    status           VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
    voided_by        INTEGER REFERENCES users(id),
    voided_at        TIMESTAMPTZ,
    void_reason      TEXT,
    served_by        INTEGER NOT NULL REFERENCES users(id),
    customer_name    VARCHAR(160),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sale_items (
    id                  SERIAL PRIMARY KEY,
    sale_id             INTEGER NOT NULL REFERENCES sales(id),
    product_id          INTEGER NOT NULL REFERENCES products(id),
    unit_price          NUMERIC(14,2) NOT NULL,
    unit_cost_snapshot  NUMERIC(14,2) NOT NULL,
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    line_subtotal       NUMERIC(14,2) NOT NULL,
    discount_type       VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK (discount_type IN ('NONE', 'FIXED', 'PERCENT')),
    discount_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    line_total           NUMERIC(14,2) NOT NULL,
    discount_reason      TEXT,
    discount_approved_by INTEGER REFERENCES users(id)
);

CREATE TABLE payments (
    id          SERIAL PRIMARY KEY,
    sale_id     INTEGER NOT NULL REFERENCES sales(id),
    amount      NUMERIC(14,2) NOT NULL,
    method      VARCHAR(20) NOT NULL DEFAULT 'CASH' CHECK (method = 'CASH'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
