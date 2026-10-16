import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PackageCheck, Search, Plus, Trash2, User, UserPlus, Check, X as XIcon } from 'lucide-react';
import { productsApi, customersApi, deliveryNotesApi, apiErrorMessage } from '../lib/api';
import { Product, Customer } from '../types';
import { todayIso } from '../lib/format';
import { Button, Card, FormField, IconChip, Input, Label, PageHeader, Textarea } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { CustomerFormModal } from '../components/CustomerFormModal';

interface DeliveryLine {
  key: string;
  product: Product;
  quantity: number;
}

// New Delivery Note create form (2026-10-16). Items are picked from the
// product catalog (quantities only — a delivery note carries no prices) and
// nothing here touches stock. "Deliver To" autocompletes from saved
// Customers; typing a name without selecting one keeps it a one-off.
export default function DeliveryNoteFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Pre-fill from a completed sale (Sales History → "Create delivery note").
  const fromSaleRef = useRef<{
    invoiceNumber: string;
    customerId: number | null;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    items: Array<{ productId: number; quantity: number }>;
  } | null>((location.state as { fromSale?: any } | null)?.fromSale ?? null);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [nextNumber, setNextNumber] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement>(null);

  const [reference, setReference] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [productQuery, setProductQuery] = useState('');
  const [items, setItems] = useState<DeliveryLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([productsApi.list(), deliveryNotesApi.nextNumber()])
      .then(([products, numberRes]) => {
        const active = products.data.filter((p) => p.status === 'active');
        setCatalog(active);
        setNextNumber(numberRes.data.deliveryNoteNumber);
        const fromSale = fromSaleRef.current;
        if (fromSale) {
          fromSaleRef.current = null; // consume once
          setCustomerId(fromSale.customerId);
          setCustomerName(fromSale.customerName);
          setCustomerPhone(fromSale.customerPhone);
          setCustomerAddress(fromSale.customerAddress);
          setInvoiceNumber(fromSale.invoiceNumber);
          const lines = fromSale.items
            .map((it) => {
              const product = active.find((p) => p.id === it.productId);
              return product ? { key: `${product.id}-${Date.now()}`, product, quantity: it.quantity } : null;
            })
            .filter((l): l is DeliveryLine => l !== null);
          setItems(lines);
          if (lines.length < fromSale.items.length) {
            toast.error('Some products from that sale are inactive and were not added — add them manually if needed.');
          }
        }
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load the form.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Customer autocomplete — debounced search-as-you-type, closes on an
  // outside click.
  useEffect(() => {
    const handle = setTimeout(() => {
      customersApi
        .search(customerQuery)
        .then((res) => setCustomerResults(res.data))
        .catch(() => {
          // Non-fatal — the picker just shows no suggestions.
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [customerQuery]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  function selectCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone ?? '');
    setCustomerAddress(c.address ?? '');
    setCustomerQuery('');
    setCustomerDropdownOpen(false);
  }
  function clearSelectedCustomer() {
    setCustomerId(null);
  }

  const filteredCatalog = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return catalog.slice(0, 30);
    return catalog.filter((p) => p.name.toLowerCase().includes(q) || (p.category_name ?? '').toLowerCase().includes(q)).slice(0, 30);
  }, [catalog, productQuery]);

  function addItem(product: Product) {
    setItems((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        { key: `${product.id}-${Date.now()}`, product, quantity: 1 },
      ];
    });
  }
  function updateItem(key: string, patch: Partial<DeliveryLine>) {
    setItems((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit() {
    if (!customerName.trim()) {
      toast.error('Enter or select a customer name.');
      return;
    }
    if (items.length === 0) {
      toast.error('Add at least one product to the delivery note.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await deliveryNotesApi.create({
        customerId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        deliveryAddress: customerAddress.trim() || null,
        deliveryDate: deliveryDate || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        invoiceNumber: invoiceNumber.trim() || null,
        items: items.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
      });
      toast.success(`Delivery note ${res.data.delivery_note_number} created.`);
      navigate(`/delivery-notes/${res.data.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create the delivery note.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 dark:text-[#77857c]">
        <PackageCheck size={18} className="mr-2 animate-pulse" /> Loading…
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={<PackageCheck size={20} />}
        title="New Delivery Note"
        subtitle={nextNumber ? `Will be numbered ${nextNumber}` : undefined}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          {/* Ship To */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <IconChip tone="blue" size={30} icon={<User size={14} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Deliver To</h3>
            </div>

            <div ref={customerBoxRef} className="relative mb-3">
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
                  <div className="max-h-56 overflow-y-auto">
                    {customerResults.length === 0 ? (
                      <p className="px-3.5 py-3 text-sm text-slate-400 dark:text-[#77857c]">No saved customers match yet.</p>
                    ) : (
                      customerResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-slate-50"
                        >
                          <span>
                            <span className="block font-medium text-slate-800 dark:text-[#eef3ef]">{c.name}</span>
                            <span className="block text-xs text-slate-400 dark:text-[#77857c]">{c.phone ?? 'No phone'}</span>
                          </span>
                          {customerId === c.id && <Check size={15} className="text-green-600" />}
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

            {customerId && (
              <div className="mb-3 flex items-center justify-between rounded-lg bg-green-50 px-3.5 py-2 text-[13px] text-green-800">
                <span>Using saved customer — editing the fields below won't change their saved record.</span>
                <button type="button" onClick={clearSelectedCustomer} className="text-green-700 hover:text-green-900">
                  <XIcon size={14} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Customer / Company Name">
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in Customer" />
              </FormField>
              <FormField label="Phone">
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="07XXXXXXXX" />
              </FormField>
              <FormField label="Delivery address" hint="Shown on the printed delivery note.">
                <Textarea rows={2} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              </FormField>
              <FormField label="Our Ref (optional)">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. order or LPO number" />
              </FormField>
            </div>
          </Card>

          {/* Item picker + list */}
          <Card>
            <div className="border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
              <h3 className="mb-3 font-bold text-slate-800 dark:text-[#eef3ef]">Items</h3>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
                <Input
                  className="pl-9"
                  placeholder="Search products to add…"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                />
              </div>
              {productQuery.trim() && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-100 dark:border-[rgba(255,255,255,0.08)]">
                  {filteredCatalog.length === 0 ? (
                    <p className="px-3.5 py-3 text-sm text-slate-400 dark:text-[#77857c]">No products match "{productQuery}".</p>
                  ) : (
                    filteredCatalog.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          addItem(p);
                          setProductQuery('');
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-green-50/60"
                      >
                        <span>
                          <span className="block font-medium text-slate-800 dark:text-[#eef3ef]">{p.name}</span>
                          <span className="block text-xs text-slate-400 dark:text-[#77857c]">
                            {p.category_name ?? 'Uncategorized'} · {p.unit}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-sm font-semibold text-green-700">
                          <Plus size={14} />
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="p-5">
              {items.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400 dark:text-[#77857c]">No items yet — search above to add products.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-[#77857c]">
                      <tr>
                        <th className="pb-2 pr-2">Product</th>
                        <th className="pb-2 px-2 text-right">Qty</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((line) => (
                        <tr key={line.key} className="border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)]">
                          <td className="py-2 pr-2">
                            <p className="font-medium text-slate-800 dark:text-[#eef3ef]">{line.product.name}</p>
                            <p className="text-xs text-slate-400 dark:text-[#77857c]">{line.product.unit}</p>
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              min={0.01}
                              step="0.01"
                              value={line.quantity}
                              onChange={(e) => updateItem(line.key, { quantity: Number(e.target.value) || 0 })}
                              className="w-20 text-right"
                            />
                          </td>
                          <td className="py-2 pl-2 text-right">
                            <button onClick={() => removeItem(line.key)} className="text-slate-300 hover:text-danger-600">
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <FormField label="Notes" hint="Anything the customer should know about this delivery.">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </Card>
        </div>

        {/* Delivery details */}
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h3 className="mb-3 font-bold text-slate-800 dark:text-[#eef3ef]">Delivery Details</h3>
            <div className="flex flex-col gap-3">
              <FormField label="Delivery date">
                <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </FormField>
              <FormField label="Invoice no. (optional)" hint="Link an existing sale now, or leave blank and link it later once the sale is done.">
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2026-0001" />
              </FormField>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-bold text-slate-800 dark:text-[#eef3ef]">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                <span>Products</span>
                <span>{items.length}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                <span>Total quantity</span>
                <span>{items.reduce((sum, l) => sum + l.quantity, 0)}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400 dark:text-[#77857c]">No prices are printed and stock is not changed — stock only moves when the sale is completed.</p>
            <Button className="mt-4 w-full" size="lg" loading={submitting} onClick={handleSubmit} disabled={items.length === 0}>
              Create Delivery Note
            </Button>
          </Card>
        </div>
      </div>

      <CustomerFormModal
        open={newCustomerModalOpen}
        onClose={() => setNewCustomerModalOpen(false)}
        editing={null}
        onSaved={(c) => {
          setNewCustomerModalOpen(false);
          selectCustomer(c);
        }}
      />
    </div>
  );
}
