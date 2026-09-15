-- Feed Fusion Tanzania — Migration 018 (2026-09-12, CLAUDE.md #50)
-- Credit/deferred-payment sales, multiple payment methods, full "Sold To"
-- details on a sale, and mobile money numbers in Business Settings.
--
-- Business rule confirmed with the owner: a sale is NEVER recorded with zero
-- payment ("no sale with no payment") — some amount (a deposit, or the full
-- total) is always collected the moment the sale is rung up. What's new is
-- that amount can be LESS than the total; the remaining balance is collected
-- later, in one or more follow-up payments, via cash, bank transfer, or
-- mobile money (POST /sales/:id/payments). This redefines BR-04: a sale is
-- still COMPLETED and stock still leaves the instant it's rung up, either
-- way — completion was never conditional on payment in the code, only in the
-- business assumption behind it. What changes is whether it's fully PAID
-- right away, or PARTIAL with a balance still owed.
--
-- `sales.payment_status` and `payments.method` both already existed with a
-- single-value CHECK (a forward-looking column from the original build,
-- per "Open decisions to revisit" in CLAUDE.md) — this just widens both.

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_status_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_status_check
    CHECK (payment_status IN ('PAID', 'PARTIAL'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
    CHECK (method IN ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY'));

-- Full "Sold To" details on a sale — a sale only ever had customer_name
-- (migration 004) and customer_phone (012); customer_address and an optional
-- link back to the Customers module (016) are new, mirroring what a
-- Quotation already snapshots. amount_paid/balance_due are NOT stored here —
-- both are always derived from SUM(payments.amount), same "never store what
-- can be computed" principle CLAUDE.md rule #1 already applies to stock.
ALTER TABLE sales ADD COLUMN customer_address VARCHAR(240);
ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id);

-- Two mobile money numbers the owner gave for receiving customer payments —
-- shown on the invoice/receipt next to the existing bank details (017) when
-- a balance is still owed. Two fixed slots, not a list table, since the
-- owner named exactly two numbers; a free-text label per number lets the
-- owner say which network each is on (M-Pesa/Tigo Pesa/Airtel Money/
-- HaloPesa/...) without this system hardcoding one.
ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS mobile_money_1_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS mobile_money_1_label  VARCHAR(40),
    ADD COLUMN IF NOT EXISTS mobile_money_2_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS mobile_money_2_label  VARCHAR(40);
