import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Tag,
  Search,
  LayoutGrid,
  List as ListIcon,
  ChevronLeft,
  ChevronRight,
  Package,
  AlertTriangle,
  Wallet,
  Award,
  TrendingUp,
  Boxes,
} from 'lucide-react';
import { productsApi, categoriesApi, inventoryApi, reportsApi, apiErrorMessage } from '../lib/api';
import { Product, Category, InventoryRow, ProductSalesRow } from '../types';
import { tzs, initials, todayIso, pageWindow } from '../lib/format';
import { CreateProductModal } from '../components/products/CreateProductModal';
import { ProposePriceModal } from '../components/products/ProposePriceModal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FullPageSpinner,
  IconChip,
  Input,
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
import { useAuth } from '../context/AuthContext';

const CHIP_TONES: Array<'green' | 'blue' | 'amber' | 'red' | 'slate'> = ['green', 'blue', 'amber', 'red', 'slate'];
const PAGE_SIZE = 10;

function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// Products page redesign (2026-09-11) — see CLAUDE.md for the judgment
// calls made building this: which reference-design elements needed real
// data behind them, and which (product photos, a "Price Source" column)
// were dropped or replaced rather than faked.
export default function ProductsPage() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [topSelling, setTopSelling] = useState<ProductSalesRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [proposeProduct, setProposeProduct] = useState<Product | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);

  function load() {
    setLoading(true);
    Promise.all([
      productsApi.list(isOwner),
      categoriesApi.list(),
      // Stock levels and sales figures are cost/margin-adjacent (BR-24), so
      // these two calls — both owner-only endpoints — are skipped entirely
      // for a sales/manager viewer rather than requested and hidden.
      isOwner ? inventoryApi.get() : Promise.resolve({ data: [] as InventoryRow[] }),
      isOwner ? reportsApi.products(monthStartIso(), todayIso()) : Promise.resolve({ data: [] as ProductSalesRow[] }),
    ])
      .then(([p, c, inv, sales]) => {
        setProducts(p.data);
        setCategories(c.data);
        setInventory(inv.data);
        setTopSelling(sales.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load products.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, statusFilter]);

  async function toggleStatus(p: Product) {
    setUpdatingId(p.id);
    try {
      await productsApi.updateStatus(p.id, p.status === 'active' ? 'inactive' : 'active');
      toast.success(`${p.name} is now ${p.status === 'active' ? 'inactive (hidden from sale)' : 'active'}.`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update this product.'));
    } finally {
      setUpdatingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const stockById = useMemo(() => new Map(inventory.map((r) => [r.id, r])), [inventory]);

  const categoryNames = useMemo(
    () => Array.from(new Set(products.map((p) => p.category_name).filter((c): c is string => !!c))).sort(),
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && p.category_name !== categoryFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.category_name ?? '').toLowerCase().includes(q);
    });
  }, [products, search, statusFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const activeProductsCount = products.filter((p) => p.status === 'active').length;
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const newProductsThisMonth = products.filter((p) => p.created_at?.slice(0, 7) === thisMonthKey).length;

  const lowStockRows = useMemo(() => inventory.filter((r) => r.status !== 'HEALTHY'), [inventory]);
  const totalStockValue = useMemo(() => inventory.reduce((sum, r) => sum + (r.stock_value_cost ?? 0), 0), [inventory]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      if (p.status !== 'active') continue;
      const key = p.category_name ?? 'Uncategorized';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [products]);
  const topCategory = categoryCounts[0] ?? null;

  const stockAlerts = useMemo(
    () =>
      lowStockRows
        .slice()
        .sort((a, b) => a.current_stock - b.current_stock)
        .slice(0, 4),
    [lowStockRows]
  );

  const topSellingSorted = useMemo(
    () =>
      topSelling
        .slice()
        .sort((a, b) => Number(b.quantity_sold) - Number(a.quantity_sold))
        .slice(0, 5),
    [topSelling]
  );
  const maxSold = topSellingSorted.reduce((max, r) => Math.max(max, Number(r.quantity_sold)), 0);

  if (loading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={isOwner ? 'Manage your product catalog, stock levels, and pricing information.' : 'Products available for sale.'}
        action={
          <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            Add New Product
          </Button>
        }
      />

      {isOwner && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Products"
            value={activeProductsCount}
            icon={<Package size={18} />}
            tone="green"
            hint={newProductsThisMonth > 0 ? `${newProductsThisMonth} new this month` : 'Active products'}
          />
          <StatCard
            label="Low Stock"
            value={lowStockRows.length}
            icon={<AlertTriangle size={18} />}
            tone="amber"
            hint={lowStockRows.length > 0 ? 'Need attention' : 'All healthy'}
          />
          <StatCard label="Total Stock Value" value={tzs(totalStockValue)} icon={<Wallet size={18} />} tone="blue" hint="At current cost" />
          <StatCard
            label="Top Category"
            value={topCategory?.[0] ?? '—'}
            icon={<Award size={18} />}
            tone="green"
            hint={topCategory ? `${topCategory[1]} products` : 'No active products yet'}
          />
        </div>
      )}

      <div className={isOwner ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]' : ''}>
        <div className="min-w-0">
          <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or category…" className="pl-9" />
            </div>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="sm:w-44">
              <option value="all">All Categories</option>
              {categoryNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="sm:w-36">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <div className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] p-1">
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className={`rounded-md p-1.5 ${viewMode === 'list' ? 'bg-green-600 text-white' : 'text-slate-400 dark:text-[#77857c] hover:text-slate-600'}`}
              >
                <ListIcon size={16} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid view"
                className={`rounded-md p-1.5 ${viewMode === 'grid' ? 'bg-green-600 text-white' : 'text-slate-400 dark:text-[#77857c] hover:text-slate-600'}`}
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </Card>

          <Card>
            {products.length === 0 ? (
              <EmptyState title="No products yet." action={<Button onClick={() => setCreateOpen(true)}>Add the first product</Button>} />
            ) : filtered.length === 0 ? (
              <EmptyState title="No products match those filters." />
            ) : viewMode === 'list' ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Product</Th>
                    <Th>Category</Th>
                    <Th>Unit</Th>
                    <Th className="text-right">Active Price</Th>
                    {isOwner && <Th className="text-right">Stock</Th>}
                    <Th>Status</Th>
                    <Th></Th>
                  </tr>
                </THead>
                <tbody>
                  {pageItems.map((p) => {
                    const stock = stockById.get(p.id);
                    return (
                      <Tr key={p.id}>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-[11px] font-bold text-white">
                              {initials(p.name)}
                            </div>
                            <div>
                              <p className="font-medium text-slate-800 dark:text-[#eef3ef]">{p.name}</p>
                              <p className="text-xs text-slate-400 dark:text-[#77857c]">PRD-{String(p.id).padStart(3, '0')}</p>
                            </div>
                          </div>
                        </Td>
                        <Td>{p.category_name ? <Badge tone="blue">{p.category_name}</Badge> : <span className="text-slate-400 dark:text-[#77857c]">—</span>}</Td>
                        <Td>{p.unit}</Td>
                        <Td className="text-right">{p.active_price ? tzs(p.active_price) : <Badge tone="amber">No price</Badge>}</Td>
                        {isOwner && (
                          <Td className="text-right">
                            {stock ? `${stock.current_stock} ${stock.unit}` : '—'}
                          </Td>
                        )}
                        <Td>
                          <Badge tone={p.status === 'active' ? 'green' : 'slate'}>{p.status}</Badge>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setProposeProduct(p)}
                              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                            >
                              <Tag size={13} /> {isOwner ? 'Set price' : 'Propose'}
                            </button>
                            {isOwner && (
                              <Button
                                size="sm"
                                variant={p.status === 'active' ? 'outline' : 'primary'}
                                loading={updatingId === p.id}
                                onClick={() => toggleStatus(p)}
                              >
                                {p.status === 'active' ? 'Deactivate' : 'Activate'}
                              </Button>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((p) => {
                  const stock = stockById.get(p.id);
                  return (
                    <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green-600 text-sm font-bold text-white">
                          {initials(p.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800 dark:text-[#eef3ef]">{p.name}</p>
                          <p className="text-xs text-slate-400 dark:text-[#77857c]">PRD-{String(p.id).padStart(3, '0')}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.category_name && <Badge tone="blue">{p.category_name}</Badge>}
                        <Badge tone={p.status === 'active' ? 'green' : 'slate'}>{p.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500 dark:text-[#97a49b]">{p.unit}</span>
                        <span className="font-semibold text-slate-800 dark:text-[#eef3ef]">{p.active_price ? tzs(p.active_price) : <Badge tone="amber">No price</Badge>}</span>
                      </div>
                      {isOwner && stock && (
                        <p className="text-xs text-slate-400 dark:text-[#77857c]">
                          {stock.current_stock} {stock.unit} in stock
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-3 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] pt-3">
                        <button
                          onClick={() => setProposeProduct(p)}
                          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                          <Tag size={13} /> {isOwner ? 'Set price' : 'Propose'}
                        </button>
                        {isOwner && (
                          <Button
                            size="sm"
                            variant={p.status === 'active' ? 'outline' : 'primary'}
                            loading={updatingId === p.id}
                            onClick={() => toggleStatus(p)}
                          >
                            {p.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
                <p className="text-[12.5px] text-slate-400 dark:text-[#77857c]">
                  Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length} products
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-slate-400 dark:text-[#77857c]">
                    Page {pageSafe} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((pg) => Math.max(1, pg - 1))}
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
                      onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
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
        </div>

        {isOwner && (
          <div className="flex flex-col gap-4">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Product Categories</h3>
                {categoryFilter !== 'all' && (
                  <button onClick={() => setCategoryFilter('all')} className="text-[11.5px] font-semibold text-blue-600 hover:underline">
                    View all
                  </button>
                )}
              </div>
              {categoryCounts.length === 0 ? (
                <p className="text-[13px] text-slate-400 dark:text-[#77857c]">No categories yet.</p>
              ) : (
                <div className="space-y-2">
                  {categoryCounts.map(([name, count], i) => (
                    <button
                      key={name}
                      onClick={() => setCategoryFilter(name)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-slate-50"
                    >
                      <IconChip tone={CHIP_TONES[i % CHIP_TONES.length]} size={30} icon={<Boxes size={14} />} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700 dark:text-[#d2dbd5]">{name}</span>
                      <span className="flex-shrink-0 text-[12.5px] font-semibold text-slate-500 dark:text-[#97a49b]">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2.5">
                <IconChip tone="red" size={30} icon={<AlertTriangle size={14} />} />
                <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Stock Alerts</h3>
              </div>
              {stockAlerts.length === 0 ? (
                <p className="text-[13px] text-slate-400 dark:text-[#77857c]">Everything is at a healthy stock level.</p>
              ) : (
                <div className="space-y-2.5">
                  {stockAlerts.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-slate-700 dark:text-[#d2dbd5]">{r.name}</p>
                        <p className="text-[11.5px] text-slate-400 dark:text-[#77857c]">
                          {r.current_stock} {r.unit} left
                        </p>
                      </div>
                      <Badge tone={r.status === 'OUT_OF_STOCK' ? 'red' : 'amber'} className="flex-shrink-0">
                        {r.status === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <IconChip tone="blue" size={30} icon={<TrendingUp size={14} />} />
                  <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Top Selling Products</h3>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">This month</span>
              </div>
              {topSellingSorted.length === 0 ? (
                <p className="text-[13px] text-slate-400 dark:text-[#77857c]">No sales recorded yet this month.</p>
              ) : (
                <div className="space-y-2.5">
                  {topSellingSorted.map((r, i) => (
                    <div key={r.product_id}>
                      <div className="mb-1 flex items-center justify-between text-[12.5px]">
                        <span className="truncate text-slate-600 dark:text-[#b6c2ba]">
                          {i + 1}. {r.product_name}
                        </span>
                        <span className="flex-shrink-0 font-semibold text-slate-700 dark:text-[#d2dbd5]">
                          {Number(r.quantity_sold).toLocaleString()} {r.unit}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]">
                        <div
                          className="h-full rounded-full bg-green-600"
                          style={{ width: `${maxSold > 0 ? (Number(r.quantity_sold) / maxSold) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

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
        product={proposeProduct}
        isOwner={isOwner}
        onClose={() => setProposeProduct(null)}
        onDone={() => {
          setProposeProduct(null);
          load();
        }}
      />
    </div>
  );
}
