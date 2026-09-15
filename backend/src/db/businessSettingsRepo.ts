import { PoolClient } from 'pg';
import { pool } from './pool';

export async function getBusinessSettings(client?: PoolClient) {
  const runner = client ?? pool;
  const { rows } = await runner.query('SELECT * FROM business_settings ORDER BY id ASC LIMIT 1');
  if (!rows[0]) {
    throw new Error(
      'No business_settings row found — run `npm run seed` once before using the app (it creates the default settings row, an owner account, and sample categories/products).'
    );
  }
  return rows[0];
}

export async function updateBusinessSettings(input: Partial<{
  businessName: string;
  phone: string;
  email: string;
  address: string;
  tin: string;
  currency: string;
  defaultMaxDiscountPct: number;
  // Added for Quotations (2026-09-12, CLAUDE.md #49) — this function
  // existed since the original build but had no route calling it until
  // now; see settings.routes.ts.
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankSwift: string;
  bankBranch: string;
  vatRatePct: number;
  quotationValidityDays: number;
  // Credit sales (2026-09-12, CLAUDE.md #50) — two mobile money numbers for
  // receiving customer payments, shown on the receipt/invoice alongside
  // bank details when a balance is owed.
  mobileMoney1Number: string;
  mobileMoney1Label: string;
  mobileMoney2Number: string;
  mobileMoney2Label: string;
  // Standard invoice/quotation Terms text (2026-09-12, CLAUDE.md #54) — a
  // fallback default shown on every printed document's Notes/Terms box
  // when that specific sale/quotation has no note of its own, so the
  // owner types boilerplate like "Payment is due in advance..." once here
  // instead of on every sale.
  invoiceTerms: string;
}>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const fieldMap: Record<string, string> = {
    businessName: 'business_name',
    phone: 'phone',
    email: 'email',
    address: 'address',
    tin: 'tin',
    currency: 'currency',
    defaultMaxDiscountPct: 'default_max_discount_pct',
    bankAccountName: 'bank_account_name',
    bankAccountNumber: 'bank_account_number',
    bankName: 'bank_name',
    bankSwift: 'bank_swift',
    bankBranch: 'bank_branch',
    vatRatePct: 'vat_rate_pct',
    quotationValidityDays: 'quotation_validity_days',
    mobileMoney1Number: 'mobile_money_1_number',
    mobileMoney1Label: 'mobile_money_1_label',
    mobileMoney2Number: 'mobile_money_2_number',
    mobileMoney2Label: 'mobile_money_2_label',
    invoiceTerms: 'invoice_terms',
  };

  for (const [key, column] of Object.entries(fieldMap)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) {
    return getBusinessSettings();
  }
  sets.push('updated_at = now()');

  const { rows } = await pool.query(
    `UPDATE business_settings SET ${sets.join(', ')} WHERE id = (SELECT id FROM business_settings ORDER BY id ASC LIMIT 1) RETURNING *`,
    values
  );
  return rows[0];
}
