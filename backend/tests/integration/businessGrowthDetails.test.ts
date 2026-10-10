import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { completeSale } from '../../src/services/sales.service';
import {
  classifySlow,
  daysOfCover,
  getBusinessGrowthDetails,
  pctChange,
  reorderSuggestion,
} from '../../src/services/businessGrowthDetails.service';
import { addDaysIso, firstOfMonthOffset, mondayOnOrBefore, todayInTanzania } from '../../src/utils/tzDate';
import { closePool, insertBusinessSettings, insertStockMovement, insertTestProduct, insertTestUser, resetDatabase } from '../testHelpers';

afterAll(async () => {
  await closePool();
});

describe('Business Growth helpers (pure)', () => {
  it('pctChange handles zero/negative baselines', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
  });

  it('daysOfCover is null with no sales, otherwise stock / daily speed', () => {
    expect(daysOfCover(100, 0, 30)).toBeNull();
    expect(daysOfCover(30, 30, 30)).toBe(30); // sells 1/day, 30 left
  });

  it('classifySlow: ignores empty and brand-new products, flags unsold and overstocked ones', () => {
    expect(classifySlow({ currentStock: 0, soldLast30d: 0, daysSinceLastSale: null, daysSinceFirstStock: 90 })).toBeNull();
    expect(classifySlow({ currentStock: 50, soldLast30d: 0, daysSinceLastSale: null, daysSinceFirstStock: 3 })).toBeNull();
    expect(classifySlow({ currentStock: 50, soldLast30d: 0, daysSinceLastSale: 45, daysSinceFirstStock: 90 })).toBe('no_recent_sales');
    expect(classifySlow({ currentStock: 50, soldLast30d: 0, daysSinceLastSale: 10, daysSinceFirstStock: 90 })).toBeNull();
    // 1/day speed (30 in 30d) with 500 left = 500 days of cover
    expect(classifySlow({ currentStock: 500, soldLast30d: 30, daysSinceLastSale: 1, daysSinceFirstStock: 90 })).toBe('overstocked');
    expect(classifySlow({ currentStock: 40, soldLast30d: 30, daysSinceLastSale: 1, daysSinceFirstStock: 90 })).toBeNull();
  });

  it('reorderSuggestion: none without sales or with plenty of cover; urgent when almost out', () => {
    expect(reorderSuggestion({ currentStock: 5, minimumStock: 2, soldLast30d: 0 })).toBeNull();
    expect(reorderSuggestion({ currentStock: 100, minimumStock: 5, soldLast30d: 30 })).toBeNull(); // 100 days cover
    const out = reorderSuggestion({ currentStock: 0, minimumStock: 5, soldLast30d: 30 });
    expect(out).toMatchObject({ urgency: 'now', suggestedQty: 14 }); // 1/day * 14 days
    const soon = reorderSuggestion({ currentStock: 8, minimumStock: 0, soldLast30d: 30 });
    expect(soon).toMatchObject({ urgency: 'soon', suggestedQty: 6 }); // 14 - 8
  });
});

describe('tzDate helpers', () => {
  it('finds Monday and month boundaries', () => {
    expect(mondayOnOrBefore('2026-10-04')).toBe('2026-09-28'); // Sunday → previous Monday
    expect(mondayOnOrBefore('2026-10-05')).toBe('2026-10-05');
    expect(firstOfMonthOffset('2026-10-15', -1)).toBe('2026-09-01');
    expect(firstOfMonthOffset('2026-01-31', -1)).toBe('2025-12-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('uses Tanzania (UTC+3) wall-clock date', () => {
    // 22:00 UTC on Oct 8 is already 01:00 on Oct 9 in Tanzania.
    expect(todayInTanzania(Date.UTC(2026, 9, 8, 22, 0, 0))).toBe('2026-10-09');
  });
});

describe('GET /api/v1/business-growth/details', () => {
  const app = createApp();
  let ownerToken = '';
  let salesToken = '';
  let ids: { fast: number; stale: number; fresh: number };

  beforeEach(async () => {
    await resetDatabase();
    await insertBusinessSettings({ defaultMaxDiscountPct: 5 });
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'Owner@12345', role: 'owner' });
    await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'Sales@12345', role: 'sales' });

    // fast: sells ~1 bag/day, only 4 left  → urgent reorder
    // stale: 40 bags that have sat unsold for 60 days → slow-moving
    // fresh: stocked yesterday, unsold → must NOT be called slow
    const fast = await insertTestProduct({ name: 'Layers Mash', unit: 'bag', activePrice: 50000, minimumStock: 10 });
    const stale = await insertTestProduct({ name: 'Old Stock Feed', unit: 'bag', activePrice: 30000 });
    const fresh = await insertTestProduct({ name: 'New Arrival', unit: 'bag', activePrice: 20000 });
    ids = { fast: fast.id, stale: stale.id, fresh: fresh.id };

    for (const [p, qty] of [[fast, 34], [stale, 40], [fresh, 10]] as const) {
      await insertStockMovement({ productId: p.id, movementType: 'PURCHASE', quantity: qty, balanceAfter: qty, createdBy: owner.id });
    }
    await pool.query("UPDATE stock_movements SET created_at = now() - interval '60 days' WHERE product_id IN ($1, $2)", [fast.id, stale.id]);
    await pool.query("UPDATE stock_movements SET created_at = now() - interval '1 day' WHERE product_id = $1", [fresh.id]);

    const today = todayInTanzania();
    // 30 single-bag cash sales of "fast", one per day over the last 30 days.
    for (let i = 0; i < 30; i++) {
      await completeSale({
        items: [{ productId: fast.id, quantity: 1 }],
        paymentMethod: 'CASH',
        paymentAmount: 50000,
        saleDate: addDaysIso(today, -i),
        customerName: i % 2 === 0 ? 'Mama Neema' : 'Baba John',
        servedBy: { id: owner.id, role: 'owner' },
      });
    }
    // A credit sale to a saved customer: owes the full 30,000, due 5 days ago.
    const { rows: cust } = await pool.query(
      "INSERT INTO customers (name, phone) VALUES ('Mama Neema Shop', '0712345678') RETURNING id"
    );
    await completeSale({
      items: [{ productId: stale.id, quantity: 1 }],
      paymentMethod: 'CASH',
      paymentAmount: 0,
      customerId: cust[0].id,
      dueDate: addDaysIso(today, -5),
      servedBy: { id: owner.id, role: 'owner' },
    });

    const login = async (email: string, password: string) =>
      (await request(app).post('/api/v1/auth/login').send({ email, password })).body.accessToken as string;
    ownerToken = await login('owner@feedfusion.co.tz', 'Owner@12345');
    salesToken = await login('sales@feedfusion.co.tz', 'Sales@12345');
  });

  it('is owner-only', async () => {
    expect((await request(app).get('/api/v1/business-growth/details')).status).toBe(401);
    expect((await request(app).get('/api/v1/business-growth/details').set('Authorization', `Bearer ${salesToken}`)).status).toBe(403);
  });

  it('flags the stale product as slow-moving but not the brand-new one', async () => {
    const res = await request(app).get('/api/v1/business-growth/details').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const slow = res.body.slowMoving.items.map((i: any) => i.productId);
    expect(slow).toContain(ids.stale);
    expect(slow).not.toContain(ids.fresh);
    expect(slow).not.toContain(ids.fast);
  });

  it('suggests an urgent reorder for the fast seller that is nearly out', async () => {
    const d = await getBusinessGrowthDetails();
    const item = d.reorder.items.find((i) => i.productId === ids.fast);
    expect(item).toBeDefined();
    // 4 bags left at ~1/day = ~4 days of cover: under the 10-day trigger, above the 3-day "now" line.
    expect(item!.urgency).toBe('soon');
    expect(item!.suggestedQty).toBe(10); // 14 days * 1/day - 4 on hand
    expect(item!.suggestedQty).toBeGreaterThan(0);
    expect(d.reorder.items.find((i) => i.productId === ids.stale)).toBeUndefined();
  });

  it('builds weekly and monthly trend with the current period marked partial', async () => {
    const d = await getBusinessGrowthDetails();
    expect(d.trend.weekly).toHaveLength(12);
    expect(d.trend.monthly).toHaveLength(6);
    expect(d.trend.weekly[11].isPartial).toBe(true);
    const total = d.trend.weekly.reduce((s, p) => s + p.revenue, 0);
    expect(total).toBeGreaterThan(0);
    expect(d.trend.monthly[5].period).toBe(todayInTanzania().slice(0, 7));
  });

  it('ranks named customers by revenue and excludes unnamed walk-ins', async () => {
    const d = await getBusinessGrowthDetails();
    const names = d.customers.top.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Mama Neema', 'Baba John']));
    expect(d.customers.top[0].revenue).toBeGreaterThanOrEqual(d.customers.top[1].revenue);
  });

  it('lists customers with open credit, overdue first, with the right totals', async () => {
    const d = await getBusinessGrowthDetails();
    expect(d.customers.debts.debtorCount).toBe(1);
    expect(d.customers.debts.totalOutstanding).toBe(30000);
    expect(d.customers.debts.items[0]).toMatchObject({
      name: 'Mama Neema Shop',
      phone: '0712345678',
      invoices: 1,
      balanceDue: 30000,
      overdueBalance: 30000,
    });
  });
});
