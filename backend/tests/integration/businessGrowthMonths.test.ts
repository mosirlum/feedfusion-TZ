import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { completeSale } from '../../src/services/sales.service';
import { buildChanges, buildMonthWindows, getMonthComparison, toMetrics } from '../../src/services/businessGrowthMonths.service';
import { closePool, insertBusinessSettings, insertStockMovement, insertTestProduct, insertTestUser, resetDatabase } from '../testHelpers';

afterAll(async () => {
  await closePool();
});

describe('buildMonthWindows (pure)', () => {
  it('compares the same number of days of last month', () => {
    const w = buildMonthWindows('2026-10-26');
    expect(w.current).toMatchObject({ month: '2026-10', from: '2026-10-01', to: '2026-10-26', daysElapsed: 26, daysInMonth: 31, isPartial: true });
    expect(w.previousSamePeriod).toMatchObject({ month: '2026-09', from: '2026-09-01', to: '2026-09-26', isFullMonth: false });
    expect(w.previousFull).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('caps the baseline at the length of a shorter previous month', () => {
    const w = buildMonthWindows('2026-10-31'); // September has 30 days
    expect(w.current.isPartial).toBe(false);
    expect(w.previousSamePeriod).toMatchObject({ to: '2026-09-30', isFullMonth: true });
  });
  it('handles January (previous month is last year) and leap February', () => {
    expect(buildMonthWindows('2027-01-10').previousSamePeriod).toMatchObject({ month: '2026-12', from: '2026-12-01', to: '2026-12-10' });
    expect(buildMonthWindows('2028-03-30').previousSamePeriod).toMatchObject({ month: '2028-02', to: '2028-02-29', isFullMonth: true });
  });
});

describe('metrics maths (pure)', () => {
  const base = { revenue: 1000, sales_count: 4, gross_profit: 400, customers_served: 2, new_customers: 1 };
  it('net profit = gross profit - expenses, avg sale rounded, null with no sales', () => {
    expect(toMetrics(base, 150)).toMatchObject({ netProfit: 250, avgSale: 250, expenses: 150 });
    expect(toMetrics({ ...base, revenue: 0, sales_count: 0, gross_profit: 0 }, 0).avgSale).toBeNull();
  });
  it('percent changes; no baseline gives null', () => {
    const cur = toMetrics({ ...base, revenue: 1500 }, 100);
    const prev = toMetrics({ ...base, revenue: 1000 }, 0);
    const c = buildChanges(cur, prev);
    expect(c.revenue).toBe(50);
    expect(c.expenses).toBeNull(); // previous expenses were 0
  });
});

describe('GET /api/v1/business-growth/month-comparison', () => {
  const app = createApp();
  let ownerToken = '';
  let salesToken = '';
  const TODAY = '2026-10-26';

  beforeEach(async () => {
    await resetDatabase();
    await insertBusinessSettings({ defaultMaxDiscountPct: 5 });
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'Owner@12345', role: 'owner' });
    await insertTestUser({ email: 'sales@feedfusion.co.tz', password: 'Sales@12345', role: 'sales' });
    const product = await insertTestProduct({ name: 'Layers Mash', unit: 'bag', activePrice: 50000 });
    await insertStockMovement({ productId: product.id, movementType: 'PURCHASE', quantity: 500, balanceAfter: 500, createdBy: owner.id });
    await pool.query('UPDATE products SET last_unit_cost = 30000 WHERE id = $1', [product.id]).catch(() => {});

    const sell = (saleDate: string, qty: number, customerName?: string) =>
      completeSale({
        items: [{ productId: product.id, quantity: qty }],
        paymentMethod: 'CASH',
        paymentAmount: 50000 * qty,
        saleDate,
        customerName,
        servedBy: { id: owner.id, role: 'owner' },
      });

    // October (so far): 3 sales on 3 days, two named customers (Asha is new, Baraka is new)
    await sell('2026-10-03', 2, 'Asha');
    await sell('2026-10-10', 1, 'Baraka');
    await sell('2026-10-20', 1, 'Asha');
    // September 1-26 (the like-for-like window): 1 sale to Asha (so she is NOT new in October)
    await sell('2026-09-05', 1, 'Asha');
    // September 27-30: inside last month's FULL total, outside the same-period window
    await sell('2026-09-29', 4);
    // An expense in each month
    await pool.query("INSERT INTO expenses (category, amount, expense_date, created_by, expense_type) VALUES ('Transport', 20000, '2026-10-12', $1, 'PERIODIC')", [owner.id]);
    await pool.query("INSERT INTO expenses (category, amount, expense_date, created_by, expense_type) VALUES ('Transport', 10000, '2026-09-12', $1, 'PERIODIC')", [owner.id]);

    const login = async (email: string, password: string) =>
      (await request(app).post('/api/v1/auth/login').send({ email, password })).body.accessToken as string;
    ownerToken = await login('owner@feedfusion.co.tz', 'Owner@12345');
    salesToken = await login('sales@feedfusion.co.tz', 'Sales@12345');
  });

  it('is owner-only', async () => {
    expect((await request(app).get('/api/v1/business-growth/month-comparison')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/business-growth/month-comparison').set('Authorization', `Bearer ${salesToken}`)).status
    ).toBe(403);
  });

  it('compares October so far with the same days of September, and shows full September separately', async () => {
    const r = await getMonthComparison(TODAY);
    expect(r.current.metrics).toMatchObject({ revenue: 200000, salesCount: 3, expenses: 20000, customersServed: 2, newCustomers: 1 });
    expect(r.previousSamePeriod.metrics).toMatchObject({ revenue: 50000, salesCount: 1, expenses: 10000, customersServed: 1, newCustomers: 1 });
    expect(r.previousFull.metrics).toMatchObject({ revenue: 250000, salesCount: 2 });
    expect(r.changes.revenue).toBe(300); // 200,000 vs 50,000
    expect(r.changes.salesCount).toBe(200);
    expect(r.current.metrics.netProfit).toBe(r.current.metrics.grossProfit - 20000);
  });

  it('ignores voided sales', async () => {
    const { rows } = await pool.query("SELECT id FROM sales WHERE sale_date::date = '2026-10-10'");
    await pool.query("UPDATE sales SET status = 'VOIDED' WHERE id = $1", [rows[0].id]);
    const r = await getMonthComparison(TODAY);
    expect(r.current.metrics.salesCount).toBe(2);
    expect(r.current.metrics.revenue).toBe(150000);
    expect(r.current.metrics.customersServed).toBe(1); // Baraka's only sale was voided
  });
});
