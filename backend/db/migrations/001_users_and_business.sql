-- Feed Fusion Tanzania — Migration 001
-- Users & business settings. No foreign key dependencies outside this file.

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    email           VARCHAR(160) UNIQUE,
    phone           VARCHAR(30),
    password_hash   TEXT NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'sales', 'manager')),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE business_settings (
    id          SERIAL PRIMARY KEY,
    business_name VARCHAR(160) NOT NULL,
    phone       VARCHAR(30),
    email       VARCHAR(160),
    address     TEXT,
    tin         VARCHAR(50),
    currency    VARCHAR(10) NOT NULL DEFAULT 'TZS',
    default_max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
