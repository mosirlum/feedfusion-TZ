/**
 * One-time (and safe-to-rerun) seed script. Creates the mandatory
 * business_settings row (the app throws without one — see
 * businessSettingsRepo.getBusinessSettings), a first owner account so there
 * is a way to log in at all, a sample sales account, and a small set of
 * demo categories/products/supplier/purchase so the dashboard, POS, and
 * inventory screens aren't empty on first run.
 *
 * Deliberately routes stock and pricing through the real service layer
 * (purchases.service.createPurchase, priceProposals.service.submitProposal)
 * rather than raw INSERTs — so seed data is created through the exact same
 * rules (stock_movements ledger, audit log, price approval) as real usage,
 * and the demo data is proof the rules work.
 *
 * Idempotent: re-running this after data already exists updates nothing and
 * creates nothing extra — every step checks for an existing row first.
 */
import { pool } from '../src/db/pool';
import { hashPassword } from '../src/utils/password';
import * as usersRepo from '../src/db/usersRepo';
import * as categoriesRepo from '../src/db/categoriesRepo';
import * as productsRepo from '../src/db/productsRepo';
import * as suppliersRepo from '../src/db/suppliersRepo';
import * as businessSettingsRepo from '../src/db/businessSettingsRepo';
import { createPurchase } from '../src/services/purchases.service';
import { submitProposal } from '../src/services/priceProposals.service';
import { AuthenticatedUser } from '../src/types/auth';

const OWNER_EMAIL = 'owner@feedfusion.co.tz';
const OWNER_PASSWORD = 'Owner@12345';
const SALES_EMAIL = 'sales@feedfusion.co.tz';
const SALES_PASSWORD = 'Sales@12345';

async function ensureBusinessSettings() {
  const { rows } = await pool.query('SELECT id FROM business_settings ORDER BY id ASC LIMIT 1');
  if (rows[0]) {
    console.log('skip   business_settings (already exists)');
    return;
  }
  await pool.query(
    `INSERT INTO business_settings (business_name, phone, email, address, currency, default_max_discount_pct)
     VALUES ($1, $2, $3, $4, 'TZS', 5.00)`,
    ['Feed Fusion Tanzania', '+255 700 000 000', 'info@feedfusion.co.tz', 'Dar es Salaam, Tanzania']
  );
  console.log('create business_settings (default_max_discount_pct = 5.00)');
}

async function ensureUser(input: { name: string; email: string; password: string; role: 'owner' | 'sales' }) {
  const existing = await usersRepo.findUserByEmail(input.email);
  if (existing) {
    console.log(`skip   user ${input.email} (already exists)`);
    return existing;
  }
  const passwordHash = await hashPassword(input.password);
  const user = await usersRepo.createUser({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
  });
  console.log(`create user ${input.email} / ${input.password} (role: ${input.role})`);
  return user;
}

async function ensureCategory(name: string) {
  const existing = await categoriesRepo.listCategories();
  const found = existing.find((c: any) => c.name === name);
  if (found) return found;
  const created = await categoriesRepo.createCategory({ name, parentId: null });
  console.log(`create category ${name}`);
  return created;
}

async function ensureProduct(input: { name: string; categoryId: number; unit: string; minimumStock: number }) {
  const existing = await productsRepo.listProducts(true);
  const found = existing.find((p: any) => p.name === input.name);
  if (found) return found;
  const created = await productsRepo.createProduct(input);
  console.log(`create product ${input.name}`);
  return created;
}

async function ensureSupplier(name: string) {
  const existing = await suppliersRepo.listSuppliers();
  const found = existing.find((s: any) => s.name === name);
  if (found) return found;
  const created = await suppliersRepo.createSupplier({
    name,
    phone: '+255 711 000 000',
    address: 'Kariakoo, Dar es Salaam',
    notes: 'Seeded demo supplier',
  });
  console.log(`create supplier ${name}`);
  return created;
}

async function main() {
  await ensureBusinessSettings();

  const owner = await ensureUser({ name: 'Amani Mrema', email: OWNER_EMAIL, password: OWNER_PASSWORD, role: 'owner' });
  await ensureUser({ name: 'Sales Demo', email: SALES_EMAIL, password: SALES_PASSWORD, role: 'sales' });
  const ownerActor: AuthenticatedUser = { id: owner.id, role: 'owner' };

  const poultryCategory = await ensureCategory('Poultry Feed');
  const fishCategory = await ensureCategory('Fish Feed');

  // Real catalog per the owner (2026-09-11 chat): Poultry Feed is sold in bags
  // under these grade codes; Fish Feed is sold by size/texture grade, by kg.
  // (Earlier seed data used "KPC-30/KPC-20" as fish-feed pellet grades — that
  // was this project's own placeholder guess, not the real catalog; corrected
  // here now that the owner has stated the actual product list.)
  const poultryProducts = [
    { name: 'KPC-30', buy: 45000, sell: 52000 },
    { name: 'KPC-20', buy: 38000, sell: 44000 },
    { name: 'KBC-35', buy: 50000, sell: 58000 },
    { name: 'KLC', buy: 42000, sell: 48000 },
    { name: 'Creep Feed', buy: 40000, sell: 47000 },
  ] as const;
  const fishProducts = [
    { name: 'Powder', buy: 1200, sell: 1600 },
    { name: 'Crumble', buy: 1400, sell: 1850 },
    { name: '1mm', buy: 1600, sell: 2100 },
    { name: '2mm', buy: 1700, sell: 2200 },
    { name: '3mm', buy: 1800, sell: 2300 },
    { name: '4mm', buy: 1900, sell: 2450 },
  ] as const;

  const poultry = await Promise.all(
    poultryProducts.map((p) => ensureProduct({ name: p.name, categoryId: poultryCategory.id, unit: 'bag', minimumStock: 10 }))
  );
  const fish = await Promise.all(
    fishProducts.map((p) => ensureProduct({ name: p.name, categoryId: fishCategory.id, unit: 'kg', minimumStock: 50 }))
  );

  const supplier = await ensureSupplier('Kilombero Feed Millers Ltd');

  const settingsRow = await businessSettingsRepo.getBusinessSettings();
  const hasAnyPurchase = (await pool.query('SELECT id FROM purchases LIMIT 1')).rows[0];

  const allProducts = [
    ...poultry.map((p, i) => ({ row: p, def: poultryProducts[i], quantity: 20 })), // bags
    ...fish.map((p, i) => ({ row: p, def: fishProducts[i], quantity: 200 })), // kg
  ];

  if (!hasAnyPurchase) {
    await createPurchase({
      supplierId: supplier.id,
      referenceNumber: 'SEED-PO-0001',
      additionalCostLines: [
        { label: 'Delivery / Transport', amount: 30000 },
        { label: 'Loading Labour', amount: 15000 },
      ],
      notes: 'Seed data — initial stock (all 11 catalog products; delivery + labour allocated proportionally)',
      items: allProducts.map(({ row, def, quantity }) => ({
        productId: row.id,
        quantity,
        unitCost: def.buy,
      })),
      createdBy: ownerActor,
    });
    console.log(`create purchase SEED-PO-0001 (initial stock across all ${allProducts.length} catalog products)`);
  } else {
    console.log('skip   sample purchase (purchases already exist)');
  }

  for (const { row, def } of allProducts) {
    const fresh = await productsRepo.findProductById(row.id);
    if (fresh && fresh.active_price === null) {
      await submitProposal({ productId: row.id, proposedPrice: def.sell, notes: 'Seed price', proposer: ownerActor });
      console.log(`set    ${def.name} active price = ${def.sell} TZS/${fresh.unit}`);
    }
  }

  console.log('\nSeed complete.');
  console.log(`Business: ${settingsRow.business_name}`);
  console.log(`Owner login   -> ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`Sales login   -> ${SALES_EMAIL} / ${SALES_PASSWORD}`);
  console.log('Change these passwords after first login.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
