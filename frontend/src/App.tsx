import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { RequireAuth } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PosPage from './pages/PosPage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import InventoryPage from './pages/InventoryPage';
import ProductsPage from './pages/ProductsPage';
// File kept as PriceApprovalsPage.tsx (renaming it would need deleting the
// old file, which isn't possible from here this session) — its default
// export is now the Change Approval Center (CLAUDE.md #35).
import ApprovalCenterPage from './pages/PriceApprovalsPage';
import StockCountPage from './pages/StockCountPage';
import StockAdjustmentsPage from './pages/StockAdjustmentsPage';
import PurchasesPage from './pages/PurchasesPage';
import SuppliersPage from './pages/SuppliersPage';
import CashControlPage from './pages/CashControlPage';
import ExpensesPage from './pages/ExpensesPage';
import ReportsPage from './pages/ReportsPage';
import AuditLogPage from './pages/AuditLogPage';
import UsersPage from './pages/UsersPage';
import MyProfilePage from './pages/MyProfilePage';
import QuotationsPage from './pages/QuotationsPage';
import QuotationFormPage from './pages/QuotationFormPage';
import QuotationViewPage from './pages/QuotationViewPage';
import CustomersPage from './pages/CustomersPage';
import SettingsPage from './pages/SettingsPage';
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
          path="/cash-control"
          element={
            <RequireAuth roles={['owner']}>
              <CashControlPage />
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
