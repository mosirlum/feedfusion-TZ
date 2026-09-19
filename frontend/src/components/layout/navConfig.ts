import {
  LayoutDashboard,
  ShoppingCart,
  History,
  Boxes,
  PackageSearch,
  BadgeCheck,
  Truck,
  Building2,
  ClipboardList,
  SlidersHorizontal,
  Receipt,
  BarChart3,
  ScrollText,
  UserCog,
  FileText,
  Users,
  Settings,
  LucideIcon,
} from 'lucide-react';
import { UserRole } from '../../types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner'] }],
  },
  {
    title: 'Sales',
    items: [
      { to: '/pos', label: 'Point of Sale', icon: ShoppingCart, roles: ['owner', 'sales', 'manager'] },
      // Opened to sales/manager 2026-09-11 (CLAUDE.md #34) — scoped
      // server-side to only the sales that user served; Total Profit stays
      // owner-only on the page itself (BR-24).
      { to: '/sales-history', label: 'Sales History', icon: History, roles: ['owner', 'sales', 'manager'] },
      // Quotations + Customers (2026-09-12, CLAUDE.md #49) — open to every
      // role, same as the POS itself: any role can quote a customer a
      // price before a sale happens.
      { to: '/quotations', label: 'Quotations', icon: FileText, roles: ['owner', 'sales', 'manager'] },
      { to: '/customers', label: 'Customers', icon: Users, roles: ['owner', 'sales', 'manager'] },
    ],
  },
  {
    title: 'Catalog & Stock',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['owner'] },
      { to: '/products', label: 'Products', icon: PackageSearch, roles: ['owner', 'sales', 'manager'] },
      // Renamed from "Price Approvals" 2026-09-11 (Change Approval Center,
      // CLAUDE.md #35) — now also reviews sale and purchase corrections,
      // not just proposed prices; Purchase Corrections' review UI moved
      // here from the Purchases page itself.
      { to: '/approvals', label: 'Change Approvals', icon: BadgeCheck, roles: ['owner'] },
      { to: '/stock-count', label: 'Stock Count', icon: ClipboardList, roles: ['owner', 'sales', 'manager'] },
      { to: '/stock-adjustments', label: 'Stock Adjustments', icon: SlidersHorizontal, roles: ['owner'] },
    ],
  },
  {
    title: 'Buying',
    items: [
      // 'sales' added 2026-09-11 — staff can now record purchases too; their
      // own edits to an already-recorded purchase need the owner's approval
      // (see purchases.service.ts / CLAUDE.md). Suppliers itself stays
      // owner-only — the Purchases form's supplier dropdown + inline "add a
      // new supplier" reach the API directly without visiting that page.
      { to: '/purchases', label: 'Purchases', icon: Truck, roles: ['owner', 'sales'] },
      { to: '/suppliers', label: 'Suppliers', icon: Building2, roles: ['owner'] },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Receipt, roles: ['owner'] },
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner'] },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/audit-log', label: 'Audit Log', icon: ScrollText, roles: ['owner'] },
      { to: '/users', label: 'Users', icon: UserCog, roles: ['owner'] },
      // Business Settings (2026-09-12, CLAUDE.md #49) — owner-only, edits
      // the shop's own identity and bank/payment details.
      { to: '/settings', label: 'Settings', icon: Settings, roles: ['owner'] },
    ],
  },
];
