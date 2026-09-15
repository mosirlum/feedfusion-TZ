-- Feed Fusion Tanzania — Migration 007
-- Expenses & cash reconciliation. Depends on 001 (users).

CREATE TABLE expenses (
    id              SERIAL PRIMARY KEY,
    category        VARCHAR(60) NOT NULL,
    amount          NUMERIC(14,2) NOT NULL,
    description      TEXT,
    expense_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_counts (
    id              SERIAL PRIMARY KEY,
    count_date      DATE NOT NULL,
    expected_cash    NUMERIC(14,2) NOT NULL,
    actual_cash      NUMERIC(14,2) NOT NULL,
    difference       NUMERIC(14,2) NOT NULL,
    notes            TEXT,
    counted_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
