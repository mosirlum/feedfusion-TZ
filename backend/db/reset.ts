/**
 * DESTRUCTIVE — irreversible. Wipes every bit of business data (categories,
 * products, suppliers, purchases, sales, stock history, expenses, cash
 * counts, price proposals, audit log) back to a genuinely empty system, so
 * you can learn the app from a clean slate instead of the seeded demo data.
 *
 * What is KEPT on purpose, so you are never locked out:
 *   - business_settings (shop name, currency, discount limit)
 *   - users (your owner + sales logins)
 *
 * What is WIPED:
 *   - categories, products
 *   - suppliers, purchases, purchase_items, purchase_additional_cost_lines
 *   - sales, sale_items, payments
 *   - stock_movements, stock_counts, stock_adjustments
 *   - price_proposals, expenses, cash_counts, audit_logs
 *   - quotations, quotation_items, customers (2026-09-12, CLAUDE.md #49)
 *
 * Every table's SERIAL id also resets to 1 (RESTART IDENTITY), so the very
 * next product/purchase/sale you create starts fresh at id 1.
 *
 * Usage:
 *   npm run db:reset          # asks you to type RESET to confirm
 *   npm run db:reset -- --yes  # skips the prompt (e.g. for scripted use)
 */
import * as readline from 'readline';
import { pool } from '../src/db/pool';

const TABLES_TO_WIPE = [
  'audit_logs',
  // Quotations feature (2026-09-12, CLAUDE.md #49) — wiped like every other
  // business-data table; business_settings' new bank/VAT/validity fields
  // are kept, same as the rest of business_settings.
  'quotation_items',
  'quotations',
  'customers',
  'cash_counts',
  'expenses',
  'stock_adjustments',
  'stock_counts',
  'payments',
  'sale_items',
  'sales',
  'price_proposals',
  'stock_movements',
  'purchase_additional_cost_lines',
  'purchase_items',
  'purchases',
  'products',
  'categories',
  'suppliers',
];

async function confirm(): Promise<boolean> {
  if (process.argv.includes('--yes')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      'This PERMANENTLY deletes every product, supplier, purchase, sale, stock record, expense and audit log.\n' +
        'Your owner/sales logins and business settings are kept. This cannot be undone.\n' +
        'Type RESET to continue, or anything else to cancel: ',
      (answer) => {
        rl.close();
        resolve(answer.trim() === 'RESET');
      }
    );
  });
}

async function main() {
  const ok = await confirm();
  if (!ok) {
    console.log('Cancelled — nothing was deleted.');
    return;
  }
  await pool.query(`TRUNCATE TABLE ${TABLES_TO_WIPE.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('\nDone — all business data wiped. business_settings and your user logins were kept.');
  console.log('Run `npm run seed` if you want the demo catalog/supplier/sample purchase back,');
  console.log('or just start adding your own suppliers and products from the app now.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
