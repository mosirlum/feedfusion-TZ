import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { completeSale } from '../../src/services/sales.service';
import * as expensesRepo from '../../src/db/expensesRepo';
import {
  computeTrajectory,
  getMonthlyOverview,
  monthWindows,
  OverviewMonth,
  verdictFor,
} from '../../src/services/businessGrowthOverview.service';
import { toMetrics } from '../../src/services/businessGrowthMonths.service';
import { closePool, insertBusinessSettings, insertStockMovement, insertTestProduct, insertTestUser, resetDatabase } from '../testHelpers';

afterAll(async () => {
  await closePool();
});

const m = (revenue: number, gross: number, expenses: number, sales = 1) =>
  toMetrics({ revenue, sales_count: sales, gross_profit: gross, customers_served: 1, new_customers: 0 }, expenses);

const month = (key: string, revenue: number, gross: number, expenses: number): OverviewMonth => {
  const metrics = m(revenue, gross, expenses);
  return { month: key, from: `${key}-01`, to: `${key}-28`, isPartial: false, metrics, ...verdictFor(metrics) };
};

describe('monthWindows / verdictFor (pure)', () => {
  it('six windows ending with the current partial month, across a year boundary', () => {
    const w = monthWindows('2027-01-10');
    expect(w.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
    expect(w[5]).toMatchObject({ from: '2027-01-01', to: '2027-01-10', isPartial: true });
    expect(w[4]).toMatchObject({ to: '2026-12-31', isPartial: false });
  });

  it('profit, loss, break-even and no data', () => {
    expect(verdictFor(m(1000, 400, 100)).verdict).toBe('profit');
    expect(verdictFor(m(1000, 400, 500)).verdict).toBe('loss');
    expect(verdictFor(m(1000, 400, 395)).verdict).toBe('breakeven'); // 0.5% margin
    expect(verdictFor(m(0, 0, 0)).verdict).toBe('no_data');
    expect(verdictFor(m(0, 0, 300))).toMatchObject({ verdict: 'loss', marginPct: null }); // costs but no sales
    expect(verdictFor(m(1000, 400, 100)).marginPct).toBe(30);
  });
});

describe('computeTrajectory (pure)', () => {
  it('needs at least two active complete months', () => {
    expect(computeTrajectory([]).status).toBe('not_enough_data');
    expect(computeTrajectory([month('2026-09', 1000, 400, 100)]).status).toBe('not_enough_data');
    // leading months with no activity don't count as history
    expect(computeTrajectory([month('2026-07', 0, 0, 0), month('2026-08', 0, 0, 0), month('2026-09', 1000, 400, 100)]).status).toBe('not_enough_data');
  });

  it('two months: last vs the one before', () => {
    const up = computeTrajectory([month('2026-08', 1000, 300, 200), month('2026-09', 1200, 500, 200)]);
    expect(up).toMatchObject({ status: 'improving', recentMonths: ['2026-09'], earlierMonths: ['2026-08'], recentAvgNetProfit: 300, earlierAvgNetProfit: 100, netProfitChangePct: 200 });
    expect(computeTrajectory([month('2026-08', 1000, 500, 200), month('2026-09', 900, 300, 200)]).status).toBe('declining');
  });

  it('small wobble is "steady"', () => {
    expect(computeTrajectory([month('2026-08', 1000, 500, 200), month('2026-09', 1000, 505, 200)]).status).toBe('steady');
  });

  it('five months: recent 3 vs earlier 2, using averages; loss to profit has no % but is improving', () => {
    const months = [
      month('2026-05', 1000, 100, 300), // -200
      month('2026-06', 1000, 100, 300), // -200
      month('2026-07', 1000, 400, 300), // +100
      month('2026-08', 1000, 400, 300),
      month('2026-09', 1000, 400, 300),
    ];
    const t = computeTrajectory(months);
    expect(t.recentMonths).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(t.earlierMonths).toEqual(['2026-05', '2026-06']);
    expect(t.status).toBe('improving');
    expect(t.netProfitChangePct).toBeNull(); // earlier average was a loss
  });
});

describe('sumExpensesByWindows matches sumExpensesForRange', () => {
  beforeEach(async () => {
    await resetDatabase();
    await insertBusinessSettings({ defaultMaxDiscountPct: 5 });
  });

  it('for lump-sum and prorated MONTHLY expenses, on whole months and partial ranges', async () => {
    const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'Owner@12345', role: 'owner' });
    const add = (category: string, amount: number, date: string, type: string) =>
      pool.query('INSERT INTO expenses (category, amount, expense_date, created_by, expense_type) VALUES ($1,$2,$3,$4,$5)', [category, amount, date, owner.id, type]);
    await add('Staff Salary', 1880000, '2026-09-30', 'MONTHLY');
    await add('Rent', 300000, '2026-08-05', 'MONTHLY');
    await add('Repairs', 45000, '2026-09-12', 'PERIODIC');
    await add('Transport', 20000, '2026-10-12', 'PERIODIC');
    const windows = [
      { from: '2026-08-01', to: '2026-08-31' },
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-10-01', to: '2026-10-26' },
      { from: '2026-09-15', to: '2026-10-03' },
    ];
    const batched = await expensesRepo.sumExpensesByWindows(windows);
    for (let i = 0; i < windows.length; i++) {
      expect(batched[i]).toBeCloseTo(await expensesRepo.sumExpensesForRange(windows[i].from, windows[i].to), 6);
    }
    expect(batched[1]).toBeCloseTo(1880000 + 45000, 6);
    expect(batched[2]).toBeCloseTo(20000, 6); // the September salary does not leak into October
  });
});

describe('GET /api/v1/business-growth/monthly-overview', () => {
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

    const sell = (saleDate: string, qty: number, customerName?: string) =>
      completeSale({
        items: [{ productId: product.id, quantity: qty }],
        paymentMethod: 'CASH',
        paymentAmount: 50000 * qty,
        saleDate,
        customerName,
        servedBy: { id: owner.id, role: 'owner' },
      });
    await sell('2026-08-10', 2, 'Asha'); // Aug
    await sell('2026-09-05', 4, 'Asha'); // Sep
    await sell('2026-09-20', 1, 'Baraka');
    await sell('2026-10-03', 3, 'Asha'); // Oct (so far)

    const add = (category: string, amount: number, date: string, type: string) =>
      pool.query('INSERT INTO expenses (category, amount, expense_date, created_by, expense_type) VALUES ($1,$2,$3,$4,$5)', [category, amount, date, owner.id, type]);
    await add('Staff Salary', 40000, '2026-08-31', 'MONTHLY');
    await add('Staff Salary', 40000, '2026-09-30', 'MONTHLY'); // September has it; October doesn't yet
    await add('Transport', 5000, '2026-10-12', 'PERIODIC');

    const login = async (email: string, password: string) =>
      (await request(app).post('/api/v1/auth/login').send({ email, password })).body.accessToken as string;
    ownerToken = await login('owner@feedfusion.co.tz', 'Owner@12345');
    salesToken = await login('sales@feedfusion.co.tz', 'Sales@12345');
  });

  it('is owner-only', async () => {
    expect((await request(app).get('/api/v1/business-growth/monthly-overview')).status).toBe(401);
    expect((await request(app).get('/api/v1/business-growth/monthly-overview').set('Authorization', `Bearer ${salesToken}`)).status).toBe(403);
  });

  it('returns six months ending with the current partial one, with quiet months as no-data', async () => {
    const r = await getMonthlyOverview(TODAY);
    expect(r.months.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(r.months[0].verdict).toBe('no_data');
    expect(r.months[5].isPartial).toBe(true);
    expect(r.months[3].metrics).toMatchObject({ revenue: 100000, salesCount: 1, expenses: 40000, customersServed: 1, newCustomers: 1 });
    expect(r.months[4].metrics).toMatchObject({ revenue: 250000, salesCount: 2, expenses: 40000, customersServed: 2, newCustomers: 1 });
    expect(r.months[5].metrics).toMatchObject({ revenue: 150000, expenses: 5000, customersServed: 1, newCustomers: 0 });
    for (const x of r.months) expect(x.metrics.netProfit).toBe(x.metrics.grossProfit - x.metrics.expenses);
  });

  it('summarises complete months and the trajectory (Sep vs Aug)', async () => {
    const r = await getMonthlyOverview(TODAY);
    expect(r.lastFullMonth).toBe('2026-09');
    expect(r.completeMonthsTotal.profitMonths + r.completeMonthsTotal.lossMonths).toBeLessThanOrEqual(2);
    expect(r.trajectory.recentMonths).toEqual(['2026-09']);
    expect(r.trajectory.earlierMonths).toEqual(['2026-08']);
    expect(r.trajectory.revenueChangePct).toBe(150);
  });

  it("warns that last month's monthly costs aren't in this month yet", async () => {
    const r = await getMonthlyOverview(TODAY);
    expect(r.missingMonthlyExpenses).toEqual({ month: '2026-10', categories: ['Staff Salary'] });
    await pool.query("INSERT INTO expenses (category, amount, expense_date, created_by, expense_type) SELECT 'Staff Salary', 40000, '2026-10-25', id, 'MONTHLY' FROM users LIMIT 1");
    expect((await getMonthlyOverview(TODAY)).missingMonthlyExpenses).toBeNull();
  });

  it('ignores voided sales', async () => {
    await pool.query("UPDATE sales SET status = 'VOIDED' WHERE sale_date::date = '2026-09-20'");
    const r = await getMonthlyOverview(TODAY);
    expect(r.months[4].metrics).toMatchObject({ revenue: 200000, salesCount: 1, customersServed: 1 });
  });
});
