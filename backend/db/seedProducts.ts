/**
 * Fills in ONLY the product catalog — categories, products, units, and
 * selling prices. No suppliers, no purchases, no stock. Meant for right
 * after `npm run db:reset`, when the owner wants to start from a genuinely
 * empty system but doesn't want to re-type all 11 products by hand.
 *
 * Safe to re-run: every step checks for an existing row by name first, so
 * running this twice creates nothing extra.
 *
 * Usage: npm run seed:products
 */
import { pool } from '../src/db/pool';
import * as usersRepo from '../src/db/usersRepo';
import * as categoriesRepo from '../src/db/categoriesRepo';
import * as productsRepo from '../src/db/productsRepo';
import { submitProposal } from '../src/services/priceProposals.service';
import { AuthenticatedUser } from '../src/types/auth';

const OWNER_EMAIL = 'owner@feedfusion.co.tz';

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

// Real catalog per the owner (2026-09-11 chat) — same list as db/seed.ts,
// but here we only need the selling price, not a buying price (no purchase
// is created by this script).
const poultryProducts = [
  { name: 'KPC-30', sell: 52000 },
  { name: 'KPC-20', sell: 44000 },
  { name: 'KBC-35', sell: 58000 },
  { name: 'KLC', sell: 48000 },
  { name: 'Creep Feed', sell: 47000 },
] as const;
const fishProducts = [
  { name: 'Powder', sell: 1600 },
  { name: 'Crumble', sell: 1850 },
  { name: '1mm', sell: 2100 },
  { name: '2mm', sell: 2200 },
  { name: '3mm', sell: 2300 },
  { name: '4mm', sell: 2450 },
] as const;

async function main() {
  const owner = await usersRepo.findUserByEmail(OWNER_EMAIL);
  if (!owner) {
    throw new Error(
      `No owner account found (${OWNER_EMAIL}) — run "npm run seed" first (or at least once) so the owner login exists.`
    );
  }
  const ownerActor: AuthenticatedUser = { id: owner.id, role: 'owner' };

  const poultryCategory = await ensureCategory('Poultry Feed');
  const fishCategory = await ensureCategory('Fish Feed');

  const poultry = await Promise.all(
    poultryProducts.map((p) => ensureProduct({ name: p.name, categoryId: poultryCategory.id, unit: 'bag', minimumStock: 10 }))
  );
  const fish = await Promise.all(
    fishProducts.map((p) => ensureProduct({ name: p.name, categoryId: fishCategory.id, unit: 'kg', minimumStock: 50 }))
  );

  const allProducts = [
    ...poultry.map((row, i) => ({ row, def: poultryProducts[i] })),
    ...fish.map((row, i) => ({ row, def: fishProducts[i] })),
  ];

  for (const { row, def } of allProducts) {
    const fresh = await productsRepo.findProductById(row.id);
    if (fresh && fresh.active_price === null) {
      await submitProposal({ productId: row.id, proposedPrice: def.sell, notes: 'Catalog fill-in', proposer: ownerActor });
      console.log(`set    ${def.name} price = ${def.sell} TZS/${fresh.unit}`);
    } else {
      console.log(`skip   ${def.name} (price already set)`);
    }
  }

  console.log(`\nDone — ${allProducts.length} products ready (0 stock until you record a purchase for each).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
