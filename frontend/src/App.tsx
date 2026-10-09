import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { RequireAuth } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { lazyWithRetry } from './lib/lazyWithRetry';

import LoginPage from './pages/LoginPage';
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'));
const PosPage = lazyWithRetry(() => import('./pages/PosPage'));
const SalesHistoryPage = lazyWithRetry(() => import('./pages/SalesHistoryPage'));
const InventoryPage = lazyWithRetry(() => import('./pages/InventoryPage'));
const ProductsPage = lazyWithRetry(() => import('./pages/ProductsPage'));
// File kept as PriceApprovalsPage.tsx (renaming it would need deleting the
// old file, which isn't possible from here this session) — its default
// export is now the Change Approval Center (CLAUDE.md #35).
const ApprovalCenterPage = lazyWithRetry(() => import('./pages/PriceApprovalsPage'));
const StockCountPage = lazyWithRetry(() => import('./pages/StockCountPage'));
const StockAdjustmentsPage = lazyWithRetry(() => import('./pages/StockAdjustmentsPage'));
const PurchasesPage = lazyWithRetry(() => import('./pages/PurchasesPage'));
const SuppliersPage = lazyWithRetry(() => import('./pages/SuppliersPage'));
const ExpensesPage = lazyWithRetry(() => import('./pages/ExpensesPage'));
const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage'));
const AuditLogPage = lazyWithRetry(() => import('./pages/AuditLogPage'));
const UsersPage = lazyWithRetry(() => import('./pages/UsersPage'));
const MyProfilePage = lazyWithRetry(() => import('./pages/MyProfilePage'));
const QuotationsPage = lazyWithRetry(() => import('./pages/QuotationsPage'));
const QuotationFormPage = lazyWithRetry(() => import('./pages/QuotationFormPage'));
const QuotationViewPage = lazyWithRetry(() => import('./pages/QuotationViewPage'));
const CustomersPage = lazyWithRetry(() => import('./pages/CustomersPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));
import NotFoundPage from './pages/NotFoundPage';

function HomeRedirect() {
  const { isOwner } = useAuth();
  return <Navigate to={isOwner ? '/dashboard' : '/pos'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth roles={['owner']}>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route path="/pos" element={<PosPage />} />
        {/* Opened beyond owner 2026-09-11 (Sales History redesign, CLAUDE.md
            #34) — a sales/manager viewer is scoped server-side to only the
            sales they served, same as Purchases (#29) opened to sales. */}
        <Route path="/sales-history" element={<SalesHistoryPage />} />
        {/* Quotations + Customers (2026-09-12, CLAUDE.md #49) — open to
            every authenticated role, same as the POS itself. Static
            /quotations/new before the dynamic /quotations/:id. */}
        <Route path="/quotations" element={<QuotationsPage />} />
        <Route path="/quotations/new" element={<QuotationFormPage />} />
        <Route path="/quotations/:id" element={<QuotationViewPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route
          path="/inventory"
          element={
            <RequireAuth roles={['owner']}>
              <InventoryPage />
            </RequireAuth>
          }
        />
        <Route path="/products" element={<ProductsPage />} />
        {/* Renamed from /price-approvals 2026-09-11 (Change Approval
            Center, CLAUDE.md #35) — the scope grew beyond just prices. */}
        <Route
          path="/approvals"
          element={
            <RequireAuth roles={['owner']}>
              <ApprovalCenterPage />
            </RequireAuth>
          }
        />
        <Route path="/stock-count" element={<StockCountPage />} />
        <Route
          path="/stock-adjustments"
          element={
            <RequireAuth roles={['owner']}>
              <StockAdjustmentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/purchases"
          element={
            // 'sales' added 2026-09-11 — see navConfig.ts for why.
            <RequireAuth roles={['owner', 'sales']}>
              <PurchasesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/suppliers"
          element={
            <RequireAuth roles={['owner']}>
              <SuppliersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/expenses"
          element={
            <RequireAuth roles={['owner']}>
              <ExpensesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireAuth roles={['owner']}>
              <ReportsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/audit-log"
          element={
            <RequireAuth roles={['owner']}>
              <AuditLogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth roles={['owner']}>
              <UsersPage />
            </RequireAuth>
          }
        />
        {/* Self-service profile (2026-09-12, CLAUDE.md #47) — any
            authenticated role, reached from AppShell's header dropdown. */}
        <Route path="/profile" element={<MyProfilePage />} />
        {/* Business Settings (2026-09-12, CLAUDE.md #49) — owner-only. */}
        <Route
          path="/settings"
          element={
            <RequireAuth roles={['owner']}>
              <SettingsPage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
