-- Feed Fusion Tanzania — Migration 002
-- Categories, products, price proposals. Depends on 001 (users).

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
    unit                VARCHAR(30) NOT NULL,
    active_price        NUMERIC(14,2),
    active_price_source VARCHAR(20) CHECK (active_price_source IN ('OWNER_SET', 'APPROVED_PROPOSAL')),
    price_last_changed_at TIMESTAMPTZ,
    price_last_changed_by INTEGER REFERENCES users(id),
    minimum_stock       INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_proposals (
    id                  SERIAL PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(id),
    proposed_price      NUMERIC(14,2) NOT NULL,
    current_active_price NUMERIC(14,2),
    proposed_by         INTEGER NOT NULL REFERENCES users(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
