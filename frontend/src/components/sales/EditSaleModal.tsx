import { useEffect, useState } from 'react';
import { Info, ShieldCheck, TriangleAlert } from 'lucide-react';
import { salesApi, apiErrorMessage } from '../../lib/api';
import { Sale } from '../../types';
import { tzs } from '../../lib/format';
import { isValidTzPhone, TZ_PHONE_ERROR } from '../../lib/phone';
import { Badge, Button, FullPageSpinner, Input, Label, Modal, Select, Textarea } from '../ui';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';

interface DraftLine {
  saleItemId: number;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountType: 'NONE' | 'FIXED' | 'PERCENT';
  discountValue: string;
  discountReason: string;
}

function lineTotalOf(quantity: number, unitPrice: number, discountType: string, discountValue: number) {
  const lineSubtotal = quantity * unitPrice;
  const rawDiscount = discountType === 'NONE' || !discountValue ? 0 : discountType === 'FIXED' ? discountValue : lineSubtotal * (discountValue / 100);
  const discountAmount = Math.min(Math.max(rawDiscount, 0), lineSubtotal);
  return lineSubtotal - discountAmount;
}

/**
 * Edit Sale (2026-09-11, Change Approval Center — CLAUDE.md #35). Two
 * independent halves in one modal, matching how the owner described the
 * flow: Customer Details saves immediately on Save; any changed Sale Item
 * (quantity/price/discount) creates an approval request instead — applied
 * right away only if the person saving is the owner. Product can't be
 * changed on a line (that's still void + re-enter), and Total/Payment
 * Amount aren't inputs at all — the "New Total" below is always derived
 * from the line items, live, using the exact same math the backend uses to
 * recompute it for real.
 */
export function EditSaleModal({
  saleId,
  onClose,
  onSaved,
}: {
  saleId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { isOwner } = useAuth();
  const toast = useToast();

  const [sale, setSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (saleId === null) {
      setSale(null);
      return;
    }
    setLoading(true);
    salesApi
      .get(saleId)
      .then((res) => {
        const s = res.data;
        setSale(s);
        setCustomerName(s.customer_name ?? '');
        setCustomerPhone(s.customer_phone ?? '');
        setNotes(s.notes ?? '');
        setReason('');
        setLines(
          s.items.map((it) => ({
            saleItemId: it.id,
            productName: it.product_name,
            unit: it.unit,
            quantity: String(it.quantity),
            unitPrice: it.unit_price,
            discountType: it.discount_type,
            discountValue: it.discount_value,
            discountReason: it.discount_reason ?? '',
          }))
        );
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load this sale.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  function updateLine(saleItemId: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.saleItemId === saleItemId ? { ...l, ...patch } : l)));
  }

  function original(saleItemId: number) {
    return sale?.items.find((it) => it.id === saleItemId) ?? null;
  }

  function lineChanged(l: DraftLine): boolean {
    const orig = original(l.saleItemId);
    if (!orig) return false;
    return (
      Number(l.quantity) !== orig.quantity ||
      Number(l.unitPrice || 0) !== Number(orig.unit_price) ||
      l.discountType !== orig.discount_type ||
      Number(l.discountValue || 0) !== Number(orig.discount_value) ||
      (l.discountReason.trim() || null) !== orig.discount_reason
    );
  }

  const changedLines = lines.filter(lineChanged);
  const headerChanged =
    !!sale &&
    (customerName.trim() !== (sale.customer_name ?? '') ||
      customerPhone.trim() !== (sale.customer_phone ?? '') ||
      notes.trim() !== (sale.notes ?? ''));

  const currentTotal = sale ? Number(sale.total) : 0;
  const newTotal = lines.reduce(
    (sum, l) => sum + lineTotalOf(Number(l.quantity) || 0, Number(l.unitPrice) || 0, l.discountType, Number(l.discountValue) || 0),
    0
  );
  const totalDelta = newTotal - currentTotal;
  const hasFinancialChange = changedLines.length > 0;

  async function handleSave() {
    if (!sale) return;
    if (customerPhone.trim() && !isValidTzPhone(customerPhone)) {
      toast.error(TZ_PHONE_ERROR);
      return;
    }
    for (const l of changedLines) {
      if (!(Number(l.quantity) > 0)) {
        toast.error(`Enter a quantity greater than zero for ${l.productName}.`);
        return;
      }
      if (Number(l.unitPrice) < 0) {
        toast.error(`Unit price for ${l.productName} can't be negative.`);
        return;
      }
      // BR-31 removed (2026-09-13, CLAUDE.md #66) — a discount reason is no
      // longer required here either, matching the backend's relaxed check.
    }
    if (hasFinancialChange && !isOwner && !reason.trim()) {
      toast.error('Explain why this sale needs to change — the owner will see this reason.');
      return;
    }
    if (!headerChanged && !hasFinancialChange) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const messages: string[] = [];
      if (headerChanged) {
        await salesApi.update(sale.id, {
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          notes: notes.trim() || null,
        });
        messages.push('Customer details updated.');
      }
      if (hasFinancialChange) {
        const res = await salesApi.requestEdit(sale.id, {
          items: changedLines.map((l) => ({
            sale_item_id: l.saleItemId,
            quantity: Number(l.quantity),
            unit_price: Number(l.unitPrice),
            discount_type: l.discountType,
            discount_value: Number(l.discountValue) || 0,
            discount_reason: l.discountReason.trim() || null,
          })),
          reason: reason.trim() || undefined,
        });
        messages.push(
          res.data.editRequest.status === 'APPROVED'
            ? `Sale updated — new total ${tzs(res.data.sale.total)}.`
            : "Change request submitted — waiting on the owner's approval."
        );
      }
      toast.success(messages.join(' '));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save these changes.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={saleId !== null}
      onClose={onClose}
      title={sale ? `Edit Sale — ${sale.invoice_number}` : 'Edit Sale'}
      size="xl"
      footer={
        sale && (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" loading={saving} onClick={handleSave}>
              Save Changes
            </Button>
          </>
        )
      }
    >
      {loading || !sale ? (
        <FullPageSpinner />
      ) : (
        <div className="space-y-5">
          {/* Customer Details — saves immediately */}
          <div className="rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)]">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] bg-slate-50 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-700 dark:text-[#d2dbd5]">Customer Details</p>
              <Badge tone="green">Saves immediately</Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <div>
                <Label>Customer name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in Customer" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0712345678" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          </div>

          {/* Sale Items — quantity/price/discount go through approval */}
          <div className="rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)]">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] bg-slate-50 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-700 dark:text-[#d2dbd5]">Sale Items</p>
              <Badge tone="amber">{isOwner ? 'Applies immediately (you\'re the owner)' : "Requires owner's approval"}</Badge>
            </div>
            <p className="flex items-center gap-1.5 border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-4 py-2 text-xs text-slate-400 dark:text-[#77857c]">
              <Info size={13} />
              Quantity, price, and discount can be corrected here. To change which product a line is, or add/remove an
              item, void this sale and re-enter it instead.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] text-left text-xs font-medium text-slate-400 dark:text-[#77857c]">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit Price</th>
                    <th className="px-2 py-2">Discount</th>
                    <th className="px-4 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const changed = lineChanged(l);
                    const total = lineTotalOf(Number(l.quantity) || 0, Number(l.unitPrice) || 0, l.discountType, Number(l.discountValue) || 0);
                    return (
                      <tr key={l.saleItemId} className={changed ? 'bg-amber-50/60' : ''}>
                        <td className="px-4 py-2 align-top">
                          <p className="font-medium text-slate-700 dark:text-[#d2dbd5]">{l.productName}</p>
                          <p className="text-xs text-slate-400 dark:text-[#77857c]">{l.unit}</p>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min={1}
                            value={l.quantity}
                            onChange={(e) => updateLine(l.saleItemId, { quantity: e.target.value })}
                            className="w-20 text-right"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min={0}
                            value={l.unitPrice}
                            onChange={(e) => updateLine(l.saleItemId, { unitPrice: e.target.value })}
                            className="w-28 text-right"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex gap-1.5">
                              <Select
                                value={l.discountType}
                                onChange={(e) => updateLine(l.saleItemId, { discountType: e.target.value as DraftLine['discountType'] })}
                                className="w-28 text-xs"
                              >
                                <option value="NONE">No discount</option>
                                <option value="FIXED">Fixed (TZS)</option>
                                <option value="PERCENT">Percent (%)</option>
                              </Select>
                              {l.discountType !== 'NONE' && (
                                <Input
                                  type="number"
                                  min={0}
                                  value={l.discountValue}
                                  onChange={(e) => updateLine(l.saleItemId, { discountValue: e.target.value })}
                                  className="w-20 text-right"
                                />
                              )}
                            </div>
                            {l.discountType !== 'NONE' && Number(l.discountValue) > 0 && (
                              <Input
                                value={l.discountReason}
                                onChange={(e) => updateLine(l.saleItemId, { discountReason: e.target.value })}
                                placeholder="Reason for discount (optional)"
                                className="text-xs"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right align-top font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasFinancialChange && !isOwner && (
              <div className="border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] p-4">
                <Label>Reason for this change (required)</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </div>
            )}
          </div>

          {/* Financial impact — always derived, never typed in */}
          <div
            className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
              totalDelta === 0 ? 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50' : totalDelta > 0 ? 'border-green-200 bg-green-50' : 'border-danger-200 bg-danger-50'
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              {hasFinancialChange ? (
                isOwner ? (
                  <ShieldCheck size={16} className="text-green-600" />
                ) : (
                  <TriangleAlert size={16} className="text-amber-500" />
                )
              ) : (
                <Info size={16} className="text-slate-400 dark:text-[#77857c]" />
              )}
              <span className="text-slate-600 dark:text-[#b6c2ba]">
                {hasFinancialChange
                  ? isOwner
                    ? 'This will apply immediately since you\'re the owner.'
                    : "This will wait for the owner's approval before it takes effect."
                  : 'No item changes yet — the total stays the same.'}
              </span>
            </div>
            <div className="text-right text-sm">
              <span className="text-slate-400 dark:text-[#77857c]">Current: {tzs(currentTotal)}</span>
              {totalDelta !== 0 && (
                <>
                  {' → '}
                  <span className={`font-semibold ${totalDelta > 0 ? 'text-green-700' : 'text-danger-600'}`}>
                    {tzs(newTotal)} ({totalDelta > 0 ? '+' : ''}
                    {tzs(totalDelta)})
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
