import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  History,
  Pencil,
  SlidersHorizontal,
  Download,
  Plus,
  Boxes,
  Package,
  Wallet,
  AlertTriangle,
  PackageX,
  Tags,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { inventoryApi, productsApi, categoriesApi, apiErrorMessage } from '../lib/api';
import { InventoryRow, StockMovement, Category } from '../types';
import { tzs, formatDateTime, initials, pageWindow } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FullPageSpinner,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { CreateProductModal } from '../components/products/CreateProductModal';
import { ProposePriceModal } from '../components/products/ProposePriceModal';

const STATUS_TONE: Record<InventoryRow['status'], 'green' | 'amber' | 'red'> = {
  HEALTHY: 'green',
  LOW: 'amber',
  OUT_OF_STOCK: 'red',
};

type SortKey = 'category_name' | 'current_stock' | 'minimum_stock' | 'active_price' | 'stock_value_cost';
type StatusFilter = 'all' | InventoryRow['status'];

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All Products' },
  { key: 'HEALTHY', label: 'Healthy' },
  { key: 'LOW', label: 'Low Stock' },
  { key: 'OUT_OF_STOCK', label: 'Out of Stock' },
];

// Inventory page redesign (2026-09-11) — see CLAUDE.md for the judgment
// calls made building this, same spirit as the Suppliers/Products
// redesigns: reuse real data wherever the reference design implied a
// number, and drop or replace anything the schema has no honest basis for.
export default function InventoryPage() {
  const toast = useToast();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [historyProduct, setHistoryProduct] = useState<InventoryRow | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [priceRow, setPriceRow] = useState<InventoryRow | null>(null);

  function load() {
    setLoading(true);
    inventoryApi
      .get()
      .then((res) => setRows(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load inventory.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    categoriesApi.list().then((res) => setCategories(res.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, pageSize]);

  async function openHistory(row: InventoryRow) {
    setHistoryProduct(row);
    setMovements(null);
    try {
      const res = await productsApi.stockHistory(row.id);
      setMovements(res.data.movements);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not load stock history.'));
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ChevronsUpDown size={13} className="text-slate-300" />;
    return sortDir === 'asc' ? <ChevronUp size={13} className="text-green-600" /> : <ChevronDown size={13} className="text-green-600" />;
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const totalStockValue = useMemo(() => rows.reduce((sum, r) => sum + (r.stock_value_cost ?? 0), 0), [rows]);
  const lowStockCount = useMemo(() => rows.filter((r) => r.status === 'LOW').length, [rows]);
  const outOfStockCount = useMemo(() => rows.filter((r) => r.status === 'OUT_OF_STOCK').length, [rows]);

  // A genuine "last stock movement" timestamp, not a made-up one — the most
  // recent stock_movements.created_at across every product (added to
  // GET /inventory as last_movement_at for this page).
  const lastUpdatedAt = useMemo(() => {
    const stamps = rows.map((r) => r.last_movement_at).filter((s): s is string => !!s);
    return stamps.length > 0 ? stamps.reduce((max, s) => (s > max ? s : max)) : null;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || (r.category_name ?? '').toLowerCase().includes(q);
    });
  }, [rows, query, statusFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      if (sortKey === 'category_name') {
        return (a.category_name ?? '').localeCompare(b.category_name ?? '') * dir;
      }
      const av = sortKey === 'active_price' ? Number(a.active_price ?? 0) : sortKey === 'stock_value_cost' ? a.stock_value_cost ?? 0 : (a[sortKey] as number);
      const bv = sortKey === 'active_price' ? Number(b.active_price ?? 0) : sortKey === 'stock_value_cost' ? b.stock_value_cost ?? 0 : (b[sortKey] as number);
      return (av - bv) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = sorted.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  function exportCsv() {
    const header = ['Product', 'Category', 'Current Stock', 'Min Stock', 'Selling Price', 'Stock Value (Cost)', 'Status'];
    const csvRows = sorted.map((r) => [
      r.name,
      r.category_name ?? '',
      `${r.current_stock} ${r.unit}`,
      `${r.minimum_stock} ${r.unit}`,
      r.active_price ?? '',
      r.stock_value_cost ?? '',
      r.status.replace('_', ' '),
    ]);
    const csv = [header, ...csvRows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        icon={<Boxes size={20} />}
        title="Inventory"
        subtitle={`Total stock value (at cost): ${tzs(totalStockValue)}`}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] px-3 py-2 text-xs text-slate-500 dark:text-[#97a49b]">
              <Clock size={13} className="text-slate-400 dark:text-[#77857c]" />
              {lastUpdatedAt ? (
                <>
                  <span className="text-slate-400 dark:text-[#77857c]">Last updated</span>
                  <span className="font-medium text-slate-600 dark:text-[#b6c2ba]">{formatDateTime(lastUpdatedAt)}</span>
                </>
              ) : (
                <span className="text-slate-400 dark:text-[#77857c]">No stock movements yet</span>
              )}
            </span>
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              Add Product
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Products" value={rows.length} icon={<Package size={18} />} tone="blue" hint="Across all categories" />
        <StatCard label="Total Stock Value" value={tzs(totalStockValue)} icon={<Wallet size={18} />} tone="green" hint="At current cost" />
        <StatCard
          label="Low Stock Items"
          value={lowStockCount}
          icon={<AlertTriangle size={18} />}
          tone="amber"
          hint={lowStockCount > 0 ? 'Need reordering soon' : 'All healthy'}
        />
        <StatCard
          label="Out of Stock"
          value={outOfStockCount}
          icon={<PackageX size={18} />}
          tone="red"
          hint={outOfStockCount > 0 ? 'Can\'t be sold right now' : 'Nothing out of stock'}
        />
        <StatCard label="Total Categories" value={categories.length} icon={<Tags size={18} />} tone="purple" hint="Defined in the catalog" />
      </div>

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                statusFilter === tab.key ? 'bg-green-600 text-white' : 'bg-slate-100 dark:bg-[#0e1512] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" className="w-56 pl-9" />
          </div>
          <Button type="button" variant="outline" icon={<Download size={15} />} onClick={exportCsv} disabled={sorted.length === 0}>
            Export
          </Button>
          <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-28">
            <option value="10">10 / page</option>
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
          </Select>
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No products yet." action={<Button onClick={() => setCreateOpen(true)}>Add the first product</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No products match those filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>#</Th>
                <Th>Product</Th>
                <Th>
                  <button onClick={() => toggleSort('category_name')} className="flex items-center gap-1">
                    Category {sortIcon('category_name')}
                  </button>
                </Th>
                <Th className="text-right">
                  <button onClick={() => toggleSort('current_stock')} className="ml-auto flex items-center gap-1">
                    Current Stock {sortIcon('current_stock')}
                  </button>
                </Th>
                <Th className="text-right">
                  <button onClick={() => toggleSort('minimum_stock')} className="ml-auto flex items-center gap-1">
                    Min. Stock {sortIcon('minimum_stock')}
                  </button>
                </Th>
                <Th className="text-right">
                  <button onClick={() => toggleSort('active_price')} className="ml-auto flex items-center gap-1">
                    Selling Price {sortIcon('active_price')}
                  </button>
                </Th>
                <Th className="text-right">
                  <button onClick={() => toggleSort('stock_value_cost')} className="ml-auto flex items-center gap-1">
                    Stock Value (Cost) {sortIcon('stock_value_cost')}
                  </button>
                </Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </THead>
            <tbody>
              {pageItems.map((r, i) => (
                <Tr key={r.id}>
                  <Td className="text-slate-400 dark:text-[#77857c]">{(pageSafe - 1) * pageSize + i + 1}</Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-[11px] font-bold text-white">
                        {initials(r.name)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800 dark:text-[#eef3ef]">{r.name}</p>
                        <p className="text-xs text-slate-400 dark:text-[#77857c]">PRD-{String(r.id).padStart(3, '0')}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{r.category_name ? <Badge tone="blue">{r.category_name}</Badge> : <span className="text-slate-400 dark:text-[#77857c]">—</span>}</Td>
                  <Td className="text-right">
                    {r.current_stock} {r.unit}
                  </Td>
                  <Td className="text-right text-slate-400 dark:text-[#77857c]">
                    {r.minimum_stock} {r.unit}
                  </Td>
                  <Td className="text-right">{r.active_price ? tzs(r.active_price) : <Badge tone="amber">No price</Badge>}</Td>
                  <Td className="text-right">{tzs(r.stock_value_cost)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <button onClick={() => openHistory(r)} className="text-slate-400 dark:text-[#77857c] hover:text-blue-600" title="Stock history">
                        <History size={16} />
                      </button>
                      <button onClick={() => setPriceRow(r)} className="text-slate-400 dark:text-[#77857c] hover:text-amber-600" title="Set price">
                        <Pencil size={16} />
                      </button>
                      <Link
                        to={`/stock-adjustments?product=${r.id}`}
                        className="text-slate-400 dark:text-[#77857c] hover:text-green-600"
                        title="Record a stock adjustment"
                      >
                        <SlidersHorizontal size={16} />
                      </Link>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
            <p className="text-[12.5px] text-slate-400 dark:text-[#77857c]">
              Showing {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, sorted.length)} of {sorted.length} products
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-slate-400 dark:text-[#77857c]">
                Page {pageSafe} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe === 1}
                  className="rounded-md px-2 py-1 text-slate-400 dark:text-[#77857c] hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={15} />
                </button>
                {pageWindow(pageSafe, totalPages).map((n, i) =>
                  n === 'gap' ? (
                    <span key={`gap-${i}`} className="px-1 text-[12.5px] text-slate-300 dark:text-[#5a655e]">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`h-7 w-7 rounded-md text-[12.5px] font-semibold ${
                        n === pageSafe ? 'bg-green-600 text-white' : 'text-slate-500 dark:text-[#97a49b] hover:bg-slate-100'
                      }`}
                    >
                      {n}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe === totalPages}
                  className="rounded-md px-2 py-1 text-slate-400 dark:text-[#77857c] hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Modal open={historyProduct !== null} onClose={() => setHistoryProduct(null)} title={`Stock History — ${historyProduct?.name ?? ''}`} size="lg">
        {!movements ? (
          <FullPageSpinner />
        ) : movements.length === 0 ? (
          <EmptyState title="No stock movements recorded yet." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Balance After</Th>
                <Th>By</Th>
              </tr>
            </THead>
            <tbody>
              {movements.map((m) => (
                <Tr key={m.id}>
                  <Td className="text-xs text-slate-400 dark:text-[#77857c]">{formatDateTime(m.created_at)}</Td>
                  <Td>
                    <Badge tone={m.quantity >= 0 ? 'green' : 'red'}>{m.movement_type.replace('_', ' ')}</Badge>
                  </Td>
                  <Td className={`text-right font-medium ${m.quantity >= 0 ? 'text-green-700' : 'text-danger-600'}`}>
                    {m.quantity >= 0 ? '+' : ''}
                    {m.quantity}
                  </Td>
                  <Td className="text-right">{m.balance_after}</Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">{m.created_by_name}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Modal>

      <CreateProductModal
        open={createOpen}
        categories={categories}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
        onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
      />

      <ProposePriceModal
        product={priceRow ? { id: priceRow.id, name: priceRow.name, active_price: priceRow.active_price } : null}
        isOwner
        onClose={() => setPriceRow(null)}
        onDone={() => {
          setPriceRow(null);
          load();
        }}
      />
    </div>
  );
}
