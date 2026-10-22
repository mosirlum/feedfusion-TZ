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
import { tzs, formatDateTime, initials, todayIso } from '../lib/format';
import { Badge, Button, Card, FormField, IconChip, Input, Label, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { ReceiptView } from '../components/ReceiptView';
import { usePrintAnimation } from '../components/PrintAnimation';
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
  const { startPrint, printOverlay } = usePrintAnimation();
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
  // Backdated sale entry (2026-09-25, owner's request) — "YYYY-MM-DD",
  // defaults to today; editable back to an earlier real day when the
  // cashier is entering a sale that actually happened before now.
  const [saleDate, setSaleDate] = useState(todayIso());
  // "Give on Credit" (2026-09-25, owner's request, migration 021) — TZS 0
  // collected right now, tracked as a real debt with a due date. Requires
  // a saved customer (customerId), never just a typed walk-in name.
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [dueDate, setDueDate] = useState('');
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
    setSaleDate(todayIso());
    setIsCreditSale(false);
    setDueDate('');
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
    // "Give on Credit" (2026-09-25) — TZS 0 is the deliberate, only-allowed
    // amount here; skip the "enter an amount" check that applies to every
    // other sale, and instead require a saved customer + a due date before
    // this ever reaches the API (the service enforces the same thing, but
    // catching it here avoids a round-trip for the common slip of
    // forgetting to pick a saved customer).
    const amount = isCreditSale ? 0 : Number(paymentAmount);
    if (!isCreditSale && (!amount || amount <= 0)) {
      toast.error('Enter the amount collected from the customer.');
      return;
    }
    if (isCreditSale && !customerId) {
      toast.error('Select a saved customer (not just a typed name) before giving this sale on credit.');
      return;
    }
    if (isCreditSale && !dueDate) {
      toast.error('Set a due date before giving this sale on credit.');
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
        sale_date: saleDate !== todayIso() ? saleDate : null,
        due_date: isCreditSale ? dueDate : null,
      });
      if (isCreditSale) {
        toast.show(
          `Sale completed on credit — invoice ${res.data.invoice_number}. ${tzs(res.data.balance_due)} owed, due ${dueDate}.`,
          'info'
        );
      } else if (res.data.payment_status === 'PARTIAL') {
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

      {/* POS layout (2026-10-09 UI pass) — two columns instead of three: a
          wide, tappable product grid on the left, and ONE sticky "sale" panel
          on the right (items → totals → payment), so the cashier's eyes only
          travel left-to-right once per sale. Logic below is unchanged. */}
      <div className="grid grid-cols-1 gap-5 pb-20 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Product catalog */}
        <div>
          <Card className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" aria-hidden="true" />
                <Input
                  ref={searchBoxRef}
                  placeholder="Search products by name or category…"
                  aria-label="Search products"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {/* Only useful on a phone: dismisses the keyboard. */}
              <Button type="button" variant="outline" className="lg:hidden" onClick={() => searchBoxRef.current?.blur()}>
                Done
              </Button>
              {query && (
                <Button type="button" variant="ghost" className="hidden lg:inline-flex" onClick={() => setQuery('')}>
                  Clear
                </Button>
              )}
            </div>

            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" role="group" aria-label="Filter by category">
              {[
                { key: 'all', label: 'All' },
                ...categoryNames.map((name) => ({ key: name, label: name })),
                ...(hasUncategorized ? [{ key: 'uncategorized', label: 'Uncategorized' }] : []),
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategoryFilter(c.key)}
                  aria-pressed={categoryFilter === c.key}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 ${
                    categoryFilter === c.key
                      ? 'bg-green-600 text-white shadow-card'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#0e1512] dark:text-[#b6c2ba] dark:hover:bg-[#17211c]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="mt-3 lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto lg:pr-1">
              {catalog.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#97a49b]">
                  No sellable products yet — add a product and set a price on the Products page first.
                </p>
              ) : filteredCatalog.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#97a49b]">No products match "{query}".</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                  {filteredCatalog.map((p) => {
                    const stock = stockById.get(p.id) ?? 0;
                    const qtyInCart = cartQtyById.get(p.id);
                    const tone = stockDotTone(stock, p.minimum_stock);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => addToCart(p)}
                          aria-label={`Add ${p.name} to the sale, ${tzs(p.active_price)}, ${stock} in stock`}
                          className={`group flex h-full w-full flex-col gap-3 rounded-xl border p-3.5 text-left transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 active:scale-[0.98] ${
                            qtyInCart
                              ? 'border-green-400 bg-green-50/70 shadow-card dark:border-green-600 dark:bg-green-900/20'
                              : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-green-300 hover:shadow-card dark:border-[rgba(255,255,255,0.1)] dark:bg-[#121a16] dark:hover:border-green-700'
                          } ${stock <= 0 ? 'opacity-75' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-[11px] font-bold text-white">
                              {initials(p.name)}
                            </div>
                            {qtyInCart ? (
                              <Badge tone="green">×{qtyInCart} in sale</Badge>
                            ) : (
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-400 transition-colors group-hover:bg-green-600 group-hover:text-white dark:bg-[#0e1512] dark:text-[#77857c]" aria-hidden="true">
                                <Plus size={14} />
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold leading-snug text-slate-800 dark:text-[#eef3ef]">{p.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">
                              {p.category_name ?? 'Uncategorized'} · {p.unit}
                            </p>
                          </div>
                          <div className="mt-auto flex items-end justify-between gap-2">
                            <p className="font-display text-base font-extrabold tabular-nums text-green-700 dark:text-green-400">{tzs(p.active_price)}</p>
                            <span className={`flex items-center gap-1.5 text-xs font-medium tabular-nums ${stock <= 0 ? 'text-danger-600 dark:text-danger-300' : 'text-slate-500 dark:text-[#97a49b]'}`}>
                              <span
                                className={`h-2 w-2 rounded-full ${tone === 'green' ? 'bg-green-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-danger-500'}`}
                                aria-hidden="true"
                              />
                              {stock <= 0 ? 'Out of stock' : `${stock} left`}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* The sale: items → totals → payment, one sticky panel */}
        <div id="pos-cart" className="flex scroll-mt-4 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-0.5">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-[rgba(255,255,255,0.08)]">
              <div className="flex items-center gap-2.5">
                <IconChip tone="blue" size={30} icon={<ShoppingCart size={14} />} />
                <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Sale items</h3>
                <Badge tone="blue">{cart.length}</Badge>
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={resetSale} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:text-danger-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-300 dark:text-[#97a49b]">
                  <RotateCcw size={12} aria-hidden="true" /> Clear
                </button>
              )}
            </div>

            <div className="max-h-[300px] overflow-y-auto px-4 py-3 lg:max-h-[max(9rem,24vh)]">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <ShoppingCart size={26} className="text-slate-300 dark:text-[#4a5650]" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-600 dark:text-[#b6c2ba]">No items yet</p>
                  <p className="text-xs text-slate-500 dark:text-[#97a49b]">Tap a product to add it to this sale.</p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {cart.map((line, idx) => {
                    const disc = lineDiscountAmount(line);
                    const stock = stockById.get(line.product.id) ?? 0;
                    const short = line.quantity > stock;
                    return (
                      <li
                        key={line.product.id}
                        className={`rounded-xl border p-3 ${short ? 'border-danger-200 bg-danger-50/50 dark:border-danger-700/50 dark:bg-danger-900/20' : 'border-slate-100 dark:border-[rgba(255,255,255,0.08)]'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">{line.product.name}</p>
                            <p className={`text-xs ${short ? 'font-semibold text-danger-600 dark:text-danger-300' : 'text-slate-500 dark:text-[#97a49b]'}`}>
                              {tzs(line.product.active_price)} each · {short ? `only ${stock} in stock` : `${stock} in stock`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.product.id)}
                            aria-label={`Remove ${line.product.name}`}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-danger-50 hover:text-danger-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-300 dark:hover:bg-danger-900/30"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.product.id, line.quantity - 1)}
                              aria-label={`Decrease ${line.product.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 active:scale-95 dark:border-[rgba(255,255,255,0.14)] dark:text-[#b6c2ba] dark:hover:bg-[#17211c]"
                            >
                              <Minus size={13} />
                            </button>
                            <span className="w-9 text-center text-sm font-bold tabular-nums" aria-live="polite">{line.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.product.id, line.quantity + 1)}
                              aria-label={`Increase ${line.product.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 active:scale-95 dark:border-[rgba(255,255,255,0.14)] dark:text-[#b6c2ba] dark:hover:bg-[#17211c]"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDiscountModalIndex(idx)}
                            className="flex items-center gap-1 rounded px-1 text-xs font-semibold text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-blue-400"
                          >
                            <Tag size={12} aria-hidden="true" /> {disc > 0 ? `-${tzs(disc)}` : 'Discount'}
                          </button>
                          <span className="font-display text-sm font-bold tabular-nums text-slate-800 dark:text-[#eef3ef]">{tzs(lineSubtotal(line) - disc)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Stock check — now one slim status row under the items */}
            <div
              role="status"
              className={`flex items-center gap-2 border-t px-5 py-2.5 text-xs ${
                cart.length === 0
                  ? 'border-slate-100 text-slate-500 dark:border-[rgba(255,255,255,0.08)] dark:text-[#97a49b]'
                  : shortages.length > 0
                    ? 'border-danger-100 bg-danger-50/60 text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/20 dark:text-danger-300'
                    : 'border-green-100 bg-green-50/60 text-green-700 dark:border-green-900/40 dark:bg-green-900/15 dark:text-green-300'
              }`}
            >
              {cart.length === 0 ? (
                <>
                  <ClipboardCheck size={15} aria-hidden="true" /> <span>Stock check runs as you add products.</span>
                </>
              ) : shortages.length > 0 ? (
                <>
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>
                    <b>Not enough stock:</b> {shortages.map((l) => l.product.name).join(', ')} — reduce the quantity to continue.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} aria-hidden="true" /> <span>All items are available in stock.</span>
                </>
              )}
            </div>

            <dl className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm dark:border-[rgba(255,255,255,0.08)]">
              <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{tzs(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                <dt>Discount</dt>
                <dd className={`tabular-nums ${totalDiscount > 0 ? 'text-danger-600 dark:text-danger-300' : ''}`}>{totalDiscount > 0 ? `-${tzs(totalDiscount)}` : tzs(0)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-slate-100 pt-2.5 dark:border-[rgba(255,255,255,0.08)]">
                <dt className="font-semibold text-slate-800 dark:text-[#eef3ef]">Total amount</dt>
                <dd className="font-display text-2xl font-extrabold tabular-nums text-slate-900 dark:text-[#f4f8f5]">{tzs(total)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <IconChip tone="green" size={30} icon={<CreditCard size={14} />} />
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Payment</h3>
            </div>

            {/* Backdated sale entry (2026-09-25, owner's request) —
                entering today a sale that actually happened on an earlier
                real day. Reports/history use this date; the stock itself
                still leaves right now, at the moment this sale completes. */}
            <Label htmlFor="pos-sale-date">Sale Date</Label>
            <Input
              id="pos-sale-date"
              type="date"
              max={todayIso()}
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              className="mb-4"
            />

            {/* "Give on Credit" (2026-09-25, owner's request, migration
                021) — TZS 0 collected right now, tracked as a real debt.
                Requires a saved customer, never just a typed walk-in name,
                since there'd be nobody to actually chase for the debt. */}
            <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-3.5 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-amber-400 dark:border-amber-700/60 dark:bg-amber-900/20">
              <span>
                <span className="block text-sm font-semibold text-amber-800 dark:text-amber-300">Kwa Deni (Give on Credit)</span>
                <span className="block text-xs text-amber-700 dark:text-amber-400">Customer takes the goods now, pays TZS 0 today.</span>
              </span>
              <input
                type="checkbox"
                checked={isCreditSale}
                onChange={(e) => setIsCreditSale(e.target.checked)}
                className="h-5 w-5 accent-amber-600"
              />
            </label>
            {isCreditSale && (
              <div className="mb-4 space-y-2">
                <Label htmlFor="pos-due-date">Due Date</Label>
                <Input id="pos-due-date" type="date" min={todayIso()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                {!customerId && (
                  <p className="text-xs font-medium text-danger-600 dark:text-danger-300">
                    Select a saved customer above (tap "Customer" and pick one from the search) — a typed walk-in name isn't enough for credit.
                  </p>
                )}
              </div>
            )}

            {!isCreditSale && (
              <>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Payment Method</p>
                <div className="mb-4 grid grid-cols-3 gap-2" role="group" aria-label="Payment method">
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
                      aria-pressed={paymentMethod === m.value}
                      className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 ${
                        paymentMethod === m.value
                          ? 'border-green-500 bg-green-50 text-green-800 dark:border-green-500 dark:bg-green-900/30 dark:text-green-200'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-[rgba(255,255,255,0.14)] dark:text-[#97a49b] dark:hover:border-[rgba(255,255,255,0.25)]'
                      }`}
                    >
                      <m.icon size={17} aria-hidden="true" />
                      <span className="text-[11.5px] font-semibold leading-tight">{m.label}</span>
                    </button>
                  ))}
                </div>

                <Label htmlFor="pos-amount">Amount Collected Now</Label>
                <div className="relative mb-1">
                  <Input
                    id="pos-amount"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder={total > 0 ? String(total) : '0'}
                    value={paymentAmount}
                    onChange={(e) => {
                      setPaymentAmountTouched(true);
                      setPaymentAmount(e.target.value);
                    }}
                    className="pr-9 text-lg font-bold"
                  />
                  {amountCoversTotal && <CheckCircle2 size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600" aria-hidden="true" />}
                </div>
                {/* Credit sales (2026-09-12, CLAUDE.md #50) — collecting less
                    than the total is allowed; the shortfall shows as a balance
                    owed instead of "Change", so it's obvious this will be a
                    PARTIAL sale before completing it. */}
                {balanceDue > 0 && amountReceived > 0 ? (
                  <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-900/20">
                    <span className="font-medium text-amber-700 dark:text-amber-300">Balance Due (owed after this sale)</span>
                    <span className="font-bold tabular-nums text-amber-800 dark:text-amber-200">{tzs(balanceDue)}</span>
                  </div>
                ) : (
                  <div className="mb-4 flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-[#97a49b]">Change</span>
                    <span className="font-semibold tabular-nums text-slate-700 dark:text-[#d2dbd5]">{tzs(change)}</span>
                  </div>
                )}
              </>
            )}

            {isCreditSale && (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-900/20">
                <span className="font-medium text-amber-700 dark:text-amber-300">Balance Due (owed after this sale)</span>
                <span className="font-bold tabular-nums text-amber-800 dark:text-amber-200">{tzs(total)}</span>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              icon={<CheckCircle2 size={17} />}
              loading={submitting}
              onClick={() => submitSale()}
              disabled={cart.length === 0 || shortages.length > 0 || (isCreditSale && (!customerId || !dueDate))}
            >
              Complete Sale{cart.length > 0 ? ` · ${tzs(total)}` : ''}
            </Button>
          </Card>
        </div>
      </div>

      {/* Phone only: a pinned summary so the cashier can always jump from the
          product list to the sale panel below. */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-panel backdrop-blur dark:border-[rgba(255,255,255,0.1)] dark:bg-[#121a16]/95 lg:hidden">
          <a
            href="#pos-cart"
            className="flex items-center justify-between gap-3 rounded-xl bg-green-600 px-4 py-3 text-white shadow-card transition-colors hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 active:bg-green-800"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingCart size={16} aria-hidden="true" /> {cart.length} item{cart.length === 1 ? '' : 's'} · Review &amp; pay
            </span>
            <span className="font-display font-extrabold tabular-nums">{tzs(total)}</span>
          </a>
        </div>
      )}

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
                // Print animation (CLAUDE.md #78) — plays ~1.6s, then calls
                // window.print() itself.
                startPrint();
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
      {printOverlay}
    </div>
  );
}
