import { Router } from 'express';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import categoriesRoutes from './categories.routes';
import productsRoutes from './products.routes';
import priceProposalsRoutes from './priceProposals.routes';
import approvalCenterRoutes from './approvalCenter.routes';
import suppliersRoutes from './suppliers.routes';
import purchasesRoutes from './purchases.routes';
import salesRoutes from './sales.routes';
import inventoryRoutes from './inventory.routes';
import stockCountsRoutes from './stockCounts.routes';
import stockAdjustmentsRoutes from './stockAdjustments.routes';
import expensesRoutes from './expenses.routes';
import cashCountsRoutes from './cashCounts.routes';
import dashboardRoutes from './dashboard.routes';
import reportsRoutes from './reports.routes';
import auditLogsRoutes from './auditLogs.routes';
import customersRoutes from './customers.routes';
import quotationsRoutes from './quotations.routes';
import settingsRoutes from './settings.routes';

const router = Router();

router.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'feedfusion-backend' }));

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/categories', categoriesRoutes);
router.use('/products', productsRoutes);
router.use('/price-proposals', priceProposalsRoutes);
// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — aggregate
// stats/activity across price proposals + sale/purchase edit requests.
// Mounted before /purchases etc. only for readability; Express doesn't
// care about route registration order across distinct path prefixes.
router.use('/approvals', approvalCenterRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/purchases', purchasesRoutes);
router.use('/sales', salesRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/stock-counts', stockCountsRoutes);
router.use('/stock-adjustments', stockAdjustmentsRoutes);
router.use('/expenses', expensesRoutes);
router.use('/cash-counts', cashCountsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportsRoutes);
router.use('/audit-logs', auditLogsRoutes);
// Customers + Quotations (2026-09-12, CLAUDE.md #49).
router.use('/customers', customersRoutes);
router.use('/quotations', quotationsRoutes);
// Business Settings (2026-09-12, CLAUDE.md #49) — updateBusinessSettings()
// in businessSettingsRepo.ts existed since the original build but had no
// route ever calling it; this is the first UI for it.
router.use('/settings', settingsRoutes);

export default router;
