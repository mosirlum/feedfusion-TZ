import { completeSale, voidSale } from '../../src/services/sales.service';
import { getCurrentStock } from '../../src/db/stockMovementsRepo';
import { pool } from '../../src/db/pool';
import {
  resetDatabase,
  insertTestUser,
  insertBusinessSettings,
  insertTestProduct,
  insertStockMovement,
  closePool,
} from '../testHelpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDatabase();
  await insertBusinessSettings({ defaultMaxDiscountPct: 5 });
});

async function seedStockedProduct(quantity: number, price = 2000) {
  const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'Owner@12345', role: 'owner' });
  const product = await insertTestProduct({ name: 'KPC-30', unit: 'kg', activePrice: price });
  await insertStockMovement({
    productId: product.id,
    movementType: 'PURCHASE',
    quantity,
    balanceAfter: quantity,
    createdBy: owner.id,
  });
  return { owner, product };
}

describe('completeSale — stock and overselling (BR-05/06/18/19)', () => {
  // Written first, before the happy-path test: this is the single most
  // financially dangerous piece of logic in the system per architecture.md.

  it('rejects a sale that requests more than the available stock', async () => {
    const { product } = await seedStockedProduct(10);
    const sales = await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'x', role: 'sales' });

    await expect(
      completeSale({
        items: [{ productId: product.id, quantity: 11 }],
        paymentAmount: 999999,
        servedBy: { id: sales.id, role: 'sales' },
      })
    ).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' });

    // Rejected sale must not have touched stock at all — the whole
    // transaction rolls back (CLAUDE.md rule #2).
    const client = await pool.connect();
    try {
      expect(await getCurrentStock(product.id, client)).toBe(10);
    } finally {
      client.release();
    }
  });

  it('never oversells when two sales for the same product are submitted concurrently', async () => {
    // The classic race: 10 in stock, two simultaneous sales each for 7.
    // Without the row lock + commit-time re-check, both could "see" 10
    // available and both succeed, leaving stock at -4. Exactly one must win.
    const { product } = await seedStockedProduct(10);
    const sales = await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'x', role: 'sales' });
    const servedBy = { id: sales.id, role: 'sales' as const };

    const results = await Promise.allSettled([
      completeSale({ items: [{ productId: product.id, quantity: 7 }], paymentAmount: 999999, servedBy }),
      completeSale({ items: [{ productId: product.id, quantity: 7 }], paymentAmount: 999999, servedBy }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' });

    const client = await pool.connect();
    try {
      const finalStock = await getCurrentStock(product.id, client);
      expect(finalStock).toBe(3); // 10 - 7, never negative
    } finally {
      client.release();
    }
  });

  it('rejects a sale for a product with no approved price (BR-27)', async () => {
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'x', role: 'owner' });
    const product = await insertTestProduct({ name: 'Unpriced', unit: 'kg', activePrice: null });
    await insertStockMovement({
      productId: product.id,
      movementType: 'PURCHASE',
      quantity: 100,
      balanceAfter: 100,
      createdBy: owner.id,
    });

    await expect(
      completeSale({
        items: [{ productId: product.id, quantity: 1 }],
        paymentAmount: 999999,
        servedBy: { id: owner.id, role: 'owner' },
      })
    ).rejects.toMatchObject({ status: 422, code: 'PRODUCT_HAS_NO_APPROVED_PRICE' });
  });

  it('completes a valid sale and records a matching negative stock movement', async () => {
    const { product } = await seedStockedProduct(20, 2000);
    const sales = await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'x', role: 'sales' });

    const sale = await completeSale({
      items: [{ productId: product.id, quantity: 5 }],
      paymentAmount: 10000,
      servedBy: { id: sales.id, role: 'sales' },
    });

    expect(sale.total).toBe('10000.00');
    expect(sale.invoice_number).toMatch(/^INV-\d{8}-[0-9A-F]{6}$/);

    const client = await pool.connect();
    try {
      expect(await getCurrentStock(product.id, client)).toBe(15);
    } finally {
      client.release();
    }
  });
});

describe('completeSale — discount limit (BR-30/31/32)', () => {
  it('requires a reason for any non-zero discount', async () => {
    const { product } = await seedStockedProduct(10, 2000);
    const sales = await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'x', role: 'sales' });

    await expect(
      completeSale({
        items: [{ productId: product.id, quantity: 1, discount: { type: 'FIXED', value: 100, reason: '' } }],
        paymentAmount: 999999,
        servedBy: { id: sales.id, role: 'sales' },
      })
    ).rejects.toMatchObject({ status: 400, code: 'DISCOUNT_REASON_REQUIRED' });
  });

  it('requires owner PIN when the discount exceeds the global limit, and rejects a wrong PIN', async () => {
    // default_max_discount_pct = 5 (see beforeEach). 2000/unit, discount of
    // 200 on one unit = 10% — above the limit.
    const { product } = await seedStockedProduct(10, 2000);
    await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'OwnerPin123', role: 'owner' });
    const sales = await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'x', role: 'sales' });
    const servedBy = { id: sales.id, role: 'sales' as const };

    await expect(
      completeSale({
        items: [
          { productId: product.id, quantity: 1, discount: { type: 'FIXED', value: 200, reason: 'negotiation' } },
        ],
        paymentAmount: 999999,
        servedBy,
      })
    ).rejects.toMatchObject({ status: 422, code: 'DISCOUNT_APPROVAL_REQUIRED' });

    await expect(
      completeSale({
        items: [
          { productId: product.id, quantity: 1, discount: { type: 'FIXED', value: 200, reason: 'negotiation' } },
        ],
        paymentAmount: 999999,
        discountPin: 'WrongPassword',
        servedBy,
      })
    ).rejects.toMatchObject({ status: 403, code: 'DISCOUNT_PIN_INVALID' });

    const sale = await completeSale({
      items: [{ productId: product.id, quantity: 1, discount: { type: 'FIXED', value: 200, reason: 'negotiation' } }],
      paymentAmount: 999999,
      discountPin: 'OwnerPin123',
      servedBy,
    });
    expect(sale.total_discount).toBe('200.00');
  });

  it('allows a discount within the global limit without a PIN', async () => {
    // 2000/unit, discount 80 on one unit = 4% — within the 5% limit.
    const { product } = await seedStockedProduct(10, 2000);
    const sales = await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'x', role: 'sales' });

    const sale = await completeSale({
      items: [{ productId: product.id, quantity: 1, discount: { type: 'FIXED', value: 80, reason: 'loyal customer' } }],
      paymentAmount: 999999,
      servedBy: { id: sales.id, role: 'sales' },
    });

    expect(sale.total_discount).toBe('80.00');
  });
});

describe('voidSale — never deletes, only reverses (BR-11/12)', () => {
  it('reverses stock via a positive VOID_REVERSAL movement and marks the sale VOIDED, not deleted', async () => {
    const { product } = await seedStockedProduct(20, 2000);
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'x', role: 'owner' });

    const sale = await completeSale({
      items: [{ productId: product.id, quantity: 6 }],
      paymentAmount: 999999,
      servedBy: { id: owner.id, role: 'owner' },
    });

    const client = await pool.connect();
    try {
      expect(await getCurrentStock(product.id, client)).toBe(14);
    } finally {
      client.release();
    }

    const voided = await voidSale(sale.id, 'customer changed mind', { id: owner.id, role: 'owner' });
    expect(voided.status).toBe('VOIDED');
    expect(voided.id).toBe(sale.id); // same row — never a new/duplicate one

    const client2 = await pool.connect();
    try {
      expect(await getCurrentStock(product.id, client2)).toBe(20); // fully reversed
    } finally {
      client2.release();
    }
  });

  it('rejects voiding a sale that is already voided', async () => {
    const { product } = await seedStockedProduct(20, 2000);
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'x', role: 'owner' });
    const sale = await completeSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentAmount: 999999,
      servedBy: { id: owner.id, role: 'owner' },
    });

    await voidSale(sale.id, 'first void', { id: owner.id, role: 'owner' });

    await expect(voidSale(sale.id, 'second void attempt', { id: owner.id, role: 'owner' })).rejects.toMatchObject({
      status: 409,
      code: 'SALE_ALREADY_VOIDED',
    });
  });

  it('requires a reason to void', async () => {
    const { product } = await seedStockedProduct(20, 2000);
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'x', role: 'owner' });
    const sale = await completeSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentAmount: 999999,
      servedBy: { id: owner.id, role: 'owner' },
    });

    await expect(voidSale(sale.id, '', { id: owner.id, role: 'owner' })).rejects.toMatchObject({
      status: 400,
      code: 'VOID_REASON_REQUIRED',
    });
  });
});
