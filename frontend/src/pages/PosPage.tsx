import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Tag,
  Printer,
  RotateCcw,
  Pencil,
  User,
  Wallet,
  Landmark,
  Smartphone,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  CreditCard,
  Check,
  UserPlus,
} from 'lucide-react';
import { productsApi, salesApi, quotationsApi, customersApi, apiErrorMessage } from '../lib/api';
import { CartLine, Customer, PaymentMethod, Product, StockLevel } from '../types';
import { tzs, formatDateTime, initials } from '../lib/format';
import { Badge, Button, Card, FormField, IconChip, Input, Label, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { ReceiptView } from '../components/ReceiptView';
import { CustomerFormModal } from '../components/CustomerFormModal';

function lineSubtotal(line: CartLine): number {
  return Number(line.product.active_price ?? 0) * line.quantity;
}
function lineDiscountAmount(line: CartLine): number {
  const sub = lineSubtotal(line);
  if (line.discountType === 'NONE' || line.discountValue <= 0) return 0;
  const amount = line.discountType === 'FIXED' ? line.discountValue : sub * (line.discountValue / 100);
  return Math.min(amount, sub);
}
// Same thresholds as inventory.service.ts's stockStatus() — reimplemented
// here client-side because this page only has quantity (StockLevel /
// Product.minimum_stock, both cost-free), not the owner-only /inventory
// response that already computes this server-side.
function stockDotTone(stock: number, minimum: number): 'green' | 'amber' | 'red' {
  if (stock <= 0) return 'red';
  if (stock <= minimum) return 'amber';
  return 'green';
}

// New Sale page redesign (2026-09-11) — see CLAUDE.md for the judgment
// calls: cash-only for now (Mobile Money/Bank left out, not just disabled),
// no "Save Draft" (no held-sale concept exists), sequential invoice numbers
// matching Purchases, and a real (not fabricated) stock-quantity source for
// the catalog list, since /inventory (which also carries cost) is
// owner-only and this page is used by the sales role too.
// Convert-to-Sale prefill (2026-09-12, Quotations feature, CLAUDE.md #49) —
// the shape QuotationViewPage.tsx's "Convert to Sale" button navigates here
// with, via router state. Read once on mount only; PosPage's core
// completeSale/submitSale transaction logic is completely untouched.
interface FromQuotationState {
  quotationId: number;
  customerName: string;
  // Full "Sold To" carried through from the quotation's own Ship To
  // (2026-09-12, CLAUDE.md #50) — previously only the name made it across.
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerId?: number | null;
  items: Array<{ productId: number; quantity: number; unitPrice: number }>;
}

export default function PosPage() {
  const { user } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const fromQuotationRef = useRef<FromQuotationState | null>(
    (location.state as { fromQuotation?: FromQuotationState } | null)?.fromQuotation ?? null
  );
  // Set once the prefilled cart's sale completes, so the resulting sale can
  // be linked back to the quotation it came from (see submitSale below).
  const pendingQuotationIdRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [nextInvoice, setNextInvoice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState('');
  const [customerPhoneDraft, setCustomerPhoneDraft] = useState('');
  const [customerAddressDraft, setCustomerAddressDraft] = useState('');
  const [customerIdDraft, setCustomerIdDraft] = useState<number | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  // 2026-09-14 (CLAUDE.md #68) — the owner's complaint: the total is
  // already calculated the moment products are added, so having to type
  // that same number again into "Amount Collected Now" for an exact-cash
  // sale (the common case) felt like pure repetition — it used to only be
  // a greyed-out placeholder, not an actual value. This field now tracks
  // the total automatically until the cashier actually edits it by hand
  // (paymentAmountTouched), so most sales need zero typing here — just
  // confirm and complete. Typing a different amount (partial payment,
  // or the customer handing over more than the total for change) still
  // works exactly as before; it just means the auto-fill has been
  // overridden for the rest of this sale.
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(false);
  const [discountModalIndex, setDiscountModalIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completedSaleId, setCompletedSaleId] = useState<number | null>(null);
  const searchBoxRef = useRef<HTMLInputElement>(null);

  // Refreshes the catalog, stock levels, and invoice-number preview without
  // flashing the full-page loader — used after completing a sale, when
  // only a quiet background refresh is wanted, not a visible reload.
  function refresh() {
    return Promise.all([productsApi.list(), productsApi.stockLevels(), salesApi.nextInvoiceNumber()])
      .then(([products, stock, invoice]) => {
        setCatalog(products.data.filter((p) => p.status === 'active'));
        setStockLevels(stock.data);
        setNextInvoice(invoice.data.invoiceNumber);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load the product catalog.')));
  }

  useEffect(() => {
    setLoading(true);
    productsApi
      .list()
      .then((products) => {
        const active = products.data.filter((p) => p.status === 'active');
        setCatalog(active);
        applyFromQuotation(active);
        return Promise.all([productsApi.stockLevels(), salesApi.nextInvoiceNumber()]);
      })
      .then((rest) => {
        if (!rest) return;
        const [stock, invoice] = rest;
        setStockLevels(stock.data);
        setNextInvoice(invoice.data.invoiceNumber);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load the product catalog.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs once, right after the catalog first loads — builds the cart from a
  // quotation's items (see FromQuotationState above) instead of a blank
  // sale. A line whose product is no longer active/available is skipped
  // and flagged rather than silently dropped; a line whose quoted price is
  // now lower than the catalog price is preserved via the cart's existing
  // per-line FIXED discount (never a negative discount) — if the catalog
  // price has since gone UP, the current price is used instead and the
  // user is told prices may have changed (CLAUDE.md #49).
  function applyFromQuotation(activeCatalog: Product[]) {
    const state = fromQuotationRef.current;
    if (!state) return;
    fromQuotationRef.current = null; // consume once
    navigate(location.pathname, { replace: true, state: null }); // clear router state

    setCustomerPhone(state.customerPhone ?? '');
    setCustomerAddress(state.customerAddress ?? '');
    setCustomerId(state.customerId ?? null);

    const byId = new Map(activeCatalog.map((p) => [p.id, p]));
    const lines: CartLine[] = [];
    const unavailable: string[] = [];
    const priceIncreased: string[] = [];

    for (const item of state.items) {
      const product = byId.get(item.productId);
      if (!product) {
        unavailable.push(`#${item.productId}`);
        continue;
      }
      const currentPrice = Number(product.active_price ?? 0);
      if (item.unitPrice < currentPrice) {
        const discountAmount = (currentPrice - item.unitPrice) * item.quantity;
        lines.push({
          product,
          quantity: item.quantity,
          discountType: 'FIXED',
          discountValue: discountAmount,
          discountReason: `Quotation price (${item.unitPrice})`,
        });
      } else {
        if (item.unitPrice > currentPrice) priceIncreased.push(product.name);
        lines.push({ product, quantity: item.quantity, discountType: 'NONE', discountValue: 0, discountReason: '' });
      }
    }

    setCart(lines);
    setCustomerName(state.customerName);
    pendingQuotationIdRef.current = state.quotationId;

    if (unavailable.length > 0) {
      toast.error(`Some quotation items could not be added automatically (no longer available) — add them manually.`);
    }
    if (priceIncreased.length > 0) {
      toast.show(`Prices have changed since this quotation was created for: ${priceIncreased.join(', ')}. Using current prices.`, 'info');
    }
    if (lines.length > 0) {
      toast.show('Cart filled in from the quotation — review before completing the sale.', 'info');
    }
  }

  // Customer search — same debounced search-as-you-type pattern as
  // QuotationFormPage.tsx's Ship To picker (2026-09-12, CLAUDE.md #50),
  // scoped to the compact Customer modal here instead of a page section.
  useEffect(() => {
    if (!editingCustomer) return;
    const handle = setTimeout(() => {
      customersApi
        .search(customerQuery)
        .then((res) => setCustomerResults(res.data))
        .catch(() => {
          // Non-fatal — the picker just shows no suggestions.
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [customerQuery, editingCustomer]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  function selectCustomerDraft(c: Customer) {
    setCustomerIdDraft(c.id);
    setCustomerDraft(c.name);
    setCustomerPhoneDraft(c.phone ?? '');
    setCustomerAddressDraft(c.address ?? '');
    setCustomerQuery('');
    setCustomerDropdownOpen(false);
  }

  const stockById = useMemo(() => new Map(stockLevels.map((s) => [s.product_id, s.current_stock])), [stockLevels]);

  const categoryNames = useMemo(
    () => Array.from(new Set(catalog.map((p) => p.category_name).filter((c): c is string => !!c))).sort(),
    [catalog]
  );
  const hasUncategorized = useMemo(() => catalog.some((p) => !p.category_name), [catalog]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((p) => {
      if (categoryFilter === 'uncategorized' && p.category_name) return false;
      if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && p.category_name !== categoryFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.category_name ?? '').toLowerCase().includes(q);
    });
  }, [catalog, query, categoryFilter]);

  const cartQtyById = useMemo(() => new Map(cart.map((l) => [l.product.id, l.quantity])), [cart]);

  const subtotal = useMemo(() => cart.reduce((sum, l) => sum + lineSubtotal(l), 0), [cart]);
  const totalDiscount = useMemo(() => cart.reduce((sum, l) => sum + lineDiscountAmount(l), 0), [cart]);
  const total = subtotal - totalDiscount;

  const shortages = useMemo(
    () => cart.filter((l) => l.quantity > (stockById.get(l.product.id) ?? 0)),
    [cart, stockById]
  );

  // Keeps "Amount Collected Now" following the total live (see the
  // paymentAmountTouched declaration above) — stops the moment the
  // cashier types in the field themselves.
  useEffect(() => {
    if (paymentAmountTouched) return;
    setPaymentAmount(total > 0 ? String(total) : '');
  }, [total, paymentAmountTouched]);

  const amountReceived = Number(paymentAmount) || 0;
  const change = Math.max(0, amountReceived - total);
  // Credit sales (2026-09-12, CLAUDE.md #50) — collecting less than the
  // total is now allowed ("no sale with no payment," not "no sale without
  // full payment"); the shortfall becomes a balance owed, collected later
  // via Sales History's "Record Payment" action.
  const balanceDue = Math.max(0, total - amountReceived);
  const amountCoversTotal = cart.length > 0 && amountReceived >= total && total > 0;

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { product, quantity: 1, discountType: 'NONE', discountValue: 0, discountReason: '' }];
    });
  }

  function updateQuantity(productId: number, quantity: number) {
    if (quantity < 1) return;
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l)));
  }

  function removeLine(productId: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  function resetSale() {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerId(null);
    setPaymentAmount('');
    setPaymentAmountTouched(false);
    setPaymentMethod('CASH');
    setCompletedSaleId(null);
    pendingQuotationIdRef.current = null;
    refresh(); // quietly picks up the next-invoice-number preview and stock levels
  }

  async function submitSale() {
    if (cart.length === 0) {
      toast.error('Add at least one product to the sale.');
      return;
    }
    if (shortages.length > 0) {
      toast.error('One or more items exceed available stock — adjust the quantity first.');
      return;
    }
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter the amount collected from the customer.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await salesApi.complete({
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          discount:
            l.discountType !== 'NONE' && l.discountValue > 0
              ? { type: l.discountType, value: l.discountValue, reason: l.discountReason }
              : undefined,
        })),
        payment_amount: amount,
        payment_method: paymentMethod,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        customer_address: customerAddress.trim() || null,
        customer_id: customerId,
      });
      if (res.data.payment_status === 'PARTIAL') {
        toast.show(
          `Sale completed — invoice ${res.data.invoice_number}. Balance of ${tzs(res.data.balance_due)} still owed.`,
          'info'
        );
      } else {
        toast.success(`Sale completed — invoice ${res.data.invoice_number}`);
      }
      // BR-32 relaxed (2026-09-13, CLAUDE.md #66) — an over-limit discount no
      // longer blocks on an owner PIN, but the cashier still gets a heads-up
      // (the sale has already gone through either way). Still recorded as a
      // Warning entry in the Audit Log server-side.
      const warnings = res.data.highDiscountWarnings;
      if (warnings && warnings.length > 0) {
        const detail = warnings.map((w) => `${w.productName} (${w.effectivePct}%)`).join(', ');
        toast.show(
          `Note: discount on ${detail} exceeds the shop's ${warnings[0].maxPct}% limit.`,
          'info'
        );
      }
      setCompletedSaleId(res.data.id);
      // Convert-to-Sale (2026-09-12, Quotations feature, CLAUDE.md #49) —
      // fire-and-forget, same pattern as markPrinted below: linking the
      // quotation to this sale must never block or fail the sale itself.
      if (pendingQuotationIdRef.current !== null) {
        quotationsApi.convert(pendingQuotationIdRef.current, res.data.id).catch(() => {});
        pendingQuotationIdRef.current = null;
      }
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === 'INVOICE_NUMBER_COLLISION') {
        // Two sales completed at almost the same instant — harmless and
        // resolved by just trying again with a fresh number.
        toast.error('That happened at the same moment as another sale — click Complete Sale again.');
        salesApi.nextInvoiceNumber().then((res) => setNextInvoice(res.data.invoiceNumber));
      } else {
        toast.error(apiErrorMessage(err, 'Could not complete the sale.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const discountLine = discountModalIndex !== null ? cart[discountModalIndex] : null;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 dark:text-[#77857c]">
        <ShoppingCart size={18} className="mr-2 animate-pulse" /> Loading the product catalog…
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={<ShoppingCart size={20} />}
        title="New Sale"
        subtitle="Create a sale, add products, collect payment and complete."
        action={
          <button
            onClick={() => {
              setCustomerDraft(customerName);
              setCustomerPhoneDraft(customerPhone);
              setCustomerAddressDraft(customerAddress);
              setCustomerIdDraft(customerId);
              setCustomerQuery('');
              setEditingCustomer(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] px-3.5 py-2 hover:border-green-300"
          >
            <User size={16} className="text-slate-400 dark:text-[#77857c]" />
            <span className="text-left text-sm">
              <span className="block text-[11px] text-slate-400 dark:text-[#77857c]">Customer</span>
              <span className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-[#eef3ef]">
                {customerName || 'Walk-in Customer'} <Pencil size={12} className="text-slate-400 dark:text-[#77857c]" />
              </span>
            </span>
          </button>
        }
      />

      {/* Customer / "Sold To" details (2026-09-12, CLAUDE.md #50) — same
          search-saved-customers pattern as the Quotation form's Ship To,
          condensed into this compact modal. Picking a saved customer fills
          phone/address; typing a fresh name keeps it a one-off, unsaved
          customer, same as before. */}
      <Modal
        open={editingCustomer}
        onClose={() => setEditingCustomer(false)}
        title="Customer"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingCustomer(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setCustomerName(customerDraft.trim());
                setCustomerPhone(customerPhoneDraft.trim());
                setCustomerAddress(customerAddressDraft.trim());
                setCustomerId(customerIdDraft);
                setEditingCustomer(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div ref={customerBoxRef} className="relative">
            <Label>Search saved customers</Label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
              <Input
                className="pl-9"
                placeholder="Type a name or phone number…"
                value={customerQuery}
                onFocus={() => setCustomerDropdownOpen(true)}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setCustomerDropdownOpen(true);
                }}
              />
            </div>
            {customerDropdownOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] shadow-panel">
                <div className="max-h-40 overflow-y-auto">
                  {customerResults.length === 0 ? (
                    <p className="px-3.5 py-3 text-sm text-slate-400 dark:text-[#77857c]">No saved customers match yet.</p>
                  ) : (
                    customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomerDraft(c)}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-slate-50"
                      >
                        <span>
                          <span className="block font-medium text-slate-800 dark:text-[#eef3ef]">{c.name}</span>
                          <span className="block text-xs text-slate-400 dark:text-[#77857c]">{c.phone ?? 'No phone'}</span>
                        </span>
                        {customerIdDraft === c.id && <Check size={15} className="text-green-600" />}
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerModalOpen(true);
                    setCustomerDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-2 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-3.5 py-2.5 text-left text-sm font-semibold text-green-700 hover:bg-green-50"
                >
                  <UserPlus size={15} /> Add new customer
                </button>
              </div>
            )}
          </div>

          <FormField label="Customer / Company Name">
            <Input
              autoFocus
              value={customerDraft}
              onChange={(e) => {
                setCustomerDraft(e.target.value);
                setCustomerIdDraft(null);
              }}
              placeholder="Walk-in Customer"
            />
          </FormField>
          <FormField label="Phone">
            <Input value={customerPhoneDraft} onChange={(e) => setCustomerPhoneDraft(e.target.value)} placeholder="07XXXXXXXX" />
          </FormField>
          <FormField label="Address" hint="Shown as 'Sold To' on the printed receipt.">
            <Textarea rows={2} value={customerAddressDraft} onChange={(e) => setCustomerAddressDraft(e.target.value)} />
          </FormField>
        </div>
      </Modal>

      <CustomerFormModal
        open={newCustomerModalOpen}
        onClose={() => setNewCustomerModalOpen(false)}
        editing={null}
        onSaved={(c) => {
          setNewCustomerModalOpen(false);
          selectCustomerDraft(c);
        }}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px_320px]">
        {/* Product catalog */}
        <div>
          <Card className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
                <Input
                  ref={searchBoxRef}
                  placeholder="Search products by name or category…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="button" variant="outline" onClick={() => searchBoxRef.current?.blur()}>
                Search
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  categoryFilter === 'all' ? 'bg-green-600 text-white' : 'bg-slate-100 dark:bg-[#0e1512] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-200'
                }`}
              >
                All
              </button>
              {categoryNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setCategoryFilter(name)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                    categoryFilter === name ? 'bg-green-600 text-white' : 'bg-slate-100 dark:bg-[#0e1512] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-200'
                  }`}
                >
                  {name}
                </button>
              ))}
              {hasUncategorized && (
                <button
                  onClick={() => setCategoryFilter('uncategorized')}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                    categoryFilter === 'uncategorized' ? 'bg-green-600 text-white' : 'bg-slate-100 dark:bg-[#0e1512] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-200'
                  }`}
                >
                  Uncategorized
                </button>
              )}
            </div>

            <div className="mt-3 max-h-[560px] space-y-1.5 overflow-y-auto">
              {catalog.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400 dark:text-[#77857c]">
                  No sellable products yet — add a product and set a price on the Products page first.
                </p>
              ) : filteredCatalog.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400 dark:text-[#77857c]">No products match "{query}".</p>
              ) : (
                filteredCatalog.map((p) => {
                  const stock = stockById.get(p.id) ?? 0;
                  const qtyInCart = cartQtyById.get(p.id);
                  const tone = stockDotTone(stock, p.minimum_stock);
                  return (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                        qtyInCart ? 'border-green-300 bg-green-50/60' : 'border-slate-100 dark:border-[rgba(255,255,255,0.08)] hover:border-green-200 hover:bg-green-50/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-[11px] font-bold text-white">
                          {initials(p.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">{p.name}</p>
                          <p className="text-xs text-slate-400 dark:text-[#77857c]">
                            {p.category_name ?? 'Uncategorized'} · {p.unit}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        <p className="text-sm font-semibold text-green-700">{tzs(p.active_price)}</p>
                        <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-[#77857c]">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              tone === 'green' ? 'bg-green-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-danger-500'
                            }`}
                          />
                          {stock}
                        </span>
                        {qtyInCart ? (
                          <Badge tone="green">×{qtyInCart}</Badge>
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300">
                            <Plus size={14} />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Sale items + stock check + summary */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Sale Items</h3>
              <div className="flex items-center gap-2">
                <Badge tone="blue">{cart.length} {cart.length === 1 ? 'item' : 'items'}</Badge>
                {cart.length > 0 && (
                  <button onClick={resetSale} className="text-xs text-slate-400 dark:text-[#77857c] hover:text-danger-600 flex items-center gap-1">
                    <RotateCcw size={12} /> Clear
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[360px] overflow-y-auto px-5 py-3">
              {cart.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400 dark:text-[#77857c]">Cart is empty. Add products from the left.</p>
              ) : (
                <div className="space-y-3">
                  {cart.map((line, idx) => {
                    const disc = lineDiscountAmount(line);
                    const stock = stockById.get(line.product.id) ?? 0;
                    const short = line.quantity > stock;
                    return (
                      <div
                        key={line.product.id}
                        className={`rounded-lg border p-3 ${short ? 'border-danger-200 bg-danger-50/40' : 'border-slate-100 dark:border-[rgba(255,255,255,0.08)]'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-800 dark:text-[#eef3ef]">{line.product.name}</p>
                            <p className="text-xs text-slate-400 dark:text-[#77857c]">
                              {line.product.category_name ?? 'Uncategorized'} · {line.product.unit}
                            </p>
                            <p className={`text-xs ${short ? 'font-semibold text-danger-600' : 'text-slate-400 dark:text-[#77857c]'}`}>Stock: {stock}</p>
                          </div>
                          <button onClick={() => removeLine(line.product.id)} className="text-slate-300 hover:text-danger-600">
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateQuantity(line.product.id, line.quantity - 1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-100"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="w-8 text-center text-sm font-medium">{line.quantity}</span>
                            <button
                              onClick={() => updateQuantity(line.product.id, line.quantity + 1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-100"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          <button
                            onClick={() => setDiscountModalIndex(idx)}
                            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          >
                            <Tag size={12} /> {disc > 0 ? `-${tzs(disc)}` : 'Discount'}
                          </button>
                        </div>
                        <div className="mt-1.5 flex justify-between text-sm">
                          <span className="text-slate-400 dark:text-[#77857c]">{tzs(line.product.active_price)} each</span>
                          <span className="font-semibold text-slate-700 dark:text-[#d2dbd5]">{tzs(lineSubtotal(line) - disc)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card className={`flex items-start gap-2.5 p-4 ${cart.length === 0 ? '' : shortages.length > 0 ? 'bg-danger-50/50' : 'bg-green-50/50'}`}>
            {cart.length === 0 ? (
              <>
                <ClipboardCheck size={18} className="mt-0.5 flex-shrink-0 text-slate-400 dark:text-[#77857c]" />
                <div>
                  <p className="text-sm font-semibold text-slate-600 dark:text-[#b6c2ba]">Stock Check</p>
                  <p className="text-xs text-slate-400 dark:text-[#77857c]">Add products to check availability.</p>
                </div>
              </>
            ) : shortages.length > 0 ? (
              <>
                <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-danger-600" />
                <div>
                  <p className="text-sm font-semibold text-danger-700">Not enough stock</p>
                  <p className="text-xs text-danger-600">
                    {shortages.map((l) => l.product.name).join(', ')} — reduce the quantity to continue.
                  </p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-green-600" />
                <div>
                  <p className="text-sm font-semibold text-green-700">Stock Check</p>
                  <p className="text-xs text-green-600">All items are available in stock.</p>
                </div>
              </>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <IconChip tone="blue" size={30} icon={<Receipt size={14} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Sale Summary</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                <span>Subtotal</span>
                <span>{tzs(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                <span>Discount</span>
                <span className={totalDiscount > 0 ? 'text-danger-600' : ''}>{totalDiscount > 0 ? `-${tzs(totalDiscount)}` : tzs(0)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] pt-2.5 text-base font-bold text-slate-800 dark:text-[#eef3ef]">
                <span>Total Amount</span>
                <span>{tzs(total)}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Payment */}
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <IconChip tone="green" size={30} icon={<CreditCard size={14} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Payment Details</h3>
            </div>

            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Payment Method</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'CASH' as const, label: 'Cash', icon: Wallet },
                  { value: 'BANK_TRANSFER' as const, label: 'Bank', icon: Landmark },
                  { value: 'MOBILE_MONEY' as const, label: 'Mobile Money', icon: Smartphone },
                ]
              ).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPaymentMethod(m.value)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-center transition-colors ${
                    paymentMethod === m.value ? 'border-green-500 bg-green-50 text-green-800' : 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:border-slate-300'
                  }`}
                >
                  <m.icon size={17} />
                  <span className="text-[11.5px] font-semibold leading-tight">{m.label}</span>
                </button>
              ))}
            </div>

            <Label>Amount Collected Now</Label>
            <div className="relative mb-1">
              <Input
                type="number"
                min={0}
                placeholder={total > 0 ? String(total) : '0'}
                value={paymentAmount}
                onChange={(e) => {
                  setPaymentAmountTouched(true);
                  setPaymentAmount(e.target.value);
                }}
                className="pr-9 text-lg font-bold"
              />
              {amountCoversTotal && <CheckCircle2 size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />}
            </div>
            {/* Credit sales (2026-09-12, CLAUDE.md #50) — collecting less
                than the total is allowed; the shortfall shows as a balance
                owed instead of "Change", so it's obvious this will be a
                PARTIAL sale before completing it. */}
            {balanceDue > 0 && amountReceived > 0 ? (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
                <span className="font-medium text-amber-700">Balance Due (owed after this sale)</span>
                <span className="font-bold text-amber-800">{tzs(balanceDue)}</span>
              </div>
            ) : (
              <div className="mb-4 flex items-center justify-between text-sm">
                <span className="text-slate-400 dark:text-[#77857c]">Change</span>
                <span className="font-semibold text-slate-700 dark:text-[#d2dbd5]">{tzs(change)}</span>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              icon={<CheckCircle2 size={17} />}
              loading={submitting}
              onClick={() => submitSale()}
              disabled={cart.length === 0 || shortages.length > 0}
            >
              Complete Sale
            </Button>
          </Card>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-slate-400 dark:text-[#77857c]">
        Sale #{nextInvoice ?? '…'} · {formatDateTime(new Date())} · Served by {user?.name}
      </p>

      {/* Discount modal */}
      {discountLine && (
        <Modal open onClose={() => setDiscountModalIndex(null)} title={`Discount — ${discountLine.product.name}`} size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setDiscountModalIndex(null)}>
                Cancel
              </Button>
              <Button onClick={() => setDiscountModalIndex(null)}>Apply</Button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select
                value={discountLine.discountType}
                onChange={(e) =>
                  setCart((prev) =>
                    prev.map((l, i) =>
                      i === discountModalIndex ? { ...l, discountType: e.target.value as CartLine['discountType'] } : l
                    )
                  )
                }
              >
                <option value="NONE">No discount</option>
                <option value="FIXED">Fixed amount (TZS)</option>
                <option value="PERCENT">Percentage (%)</option>
              </Select>
            </div>
            {discountLine.discountType !== 'NONE' && (
              <>
                <div>
                  <Label>{discountLine.discountType === 'FIXED' ? 'Amount (TZS)' : 'Percentage'}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={discountLine.discountValue || ''}
                    onChange={(e) =>
                      setCart((prev) =>
                        prev.map((l, i) => (i === discountModalIndex ? { ...l, discountValue: Number(e.target.value) } : l))
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Reason (optional)</Label>
                  <Textarea
                    rows={2}
                    placeholder="e.g. customer negotiation, loyal customer… (optional)"
                    value={discountLine.discountReason}
                    onChange={(e) =>
                      setCart((prev) =>
                        prev.map((l, i) => (i === discountModalIndex ? { ...l, discountReason: e.target.value } : l))
                      )
                    }
                  />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Sale complete modal */}
      <Modal open={completedSaleId !== null} onClose={resetSale} title="Sale Complete" size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                // Invoice print tracking (2026-09-12, CLAUDE.md #47) —
                // fire-and-forget: printing must never be blocked by this
                // call, so window.print() runs regardless of its outcome.
                if (completedSaleId !== null) salesApi.markPrinted(completedSaleId).catch(() => {});
                window.print();
              }}
              icon={<Printer size={15} />}
            >
              Print Receipt
            </Button>
            <Button onClick={resetSale}>New Sale</Button>
          </>
        }
      >
        {completedSaleId !== null && <ReceiptView saleId={completedSaleId} />}
      </Modal>
    </div>
  );
}
