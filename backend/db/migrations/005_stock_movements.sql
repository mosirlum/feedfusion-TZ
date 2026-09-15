-- Feed Fusion Tanzania — Migration 005
-- Stock movements: the single source of truth for quantity. Depends on 001, 002.

CREATE TABLE stock_movements (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    movement_type   VARCHAR(20) NOT NULL CHECK (movement_type IN
                        ('PURCHASE', 'SALE', 'VOID_REVERSAL', 'ADJUSTMENT', 'COUNT_CORRECTION')),
    quantity        INTEGER NOT NULL,
    reference_type  VARCHAR(30),
    reference_id    INTEGER,
    balance_after    INTEGER NOT NULL,
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at);
