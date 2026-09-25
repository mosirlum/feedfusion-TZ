import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft, Send, CheckCircle2, XCircle, Clock, ShoppingCart } from 'lucide-react';
import { quotationsApi, settingsApi, apiErrorMessage } from '../lib/api';
import { Quotation, BusinessSettings, QuotationStatus } from '../types';
import { tzs, formatDate } from '../lib/format';
import { Badge, Button, FullPageSpinner } from '../components/ui';
import { useToast } from '../components/ui/Toast';

// New Quotation view/print page (2026-09-12, CLAUDE.md #49) — mirrors the
// look of the "QUOTATION" Word template delivered earlier (logo + business
// header, blue title, green items table, dark-green totals bar) so the
// app-generated version and the owner's original Word template read as the
// same document family. Uses the app's existing .print-area/.no-print
// convention (see index.css), same as ReceiptView.tsx.
const STATUS_TONE: Record<QuotationStatus, 'slate' | 'green' | 'blue' | 'red' | 'amber'> = {
  DRAFT: 'slate',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'amber',
  CONVERTED: 'green',
};

export default function QuotationViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!id) return;
    setLoading(true);
    Promise.all([quotationsApi.get(Number(id)), settingsApi.get()])
      .then(([quoRes, settingsRes]) => {
        setQuotation(quoRes.data);
        setSettings(settingsRes.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load this quotation.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function changeStatus(status: Exclude<QuotationStatus, 'CONVERTED'>) {
    if (!quotation) return;
    setBusy(true);
    try {
      const res = await quotationsApi.updateStatus(quotation.id, status);
      setQuotation((prev) => (prev ? { ...prev, status: res.data.status } : prev));
      toast.success(`Marked as ${status.toLowerCase()}.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update the status.'));
    } finally {
      setBusy(false);
    }
  }

  function convertToSale() {
    if (!quotation) return;
    navigate('/pos', {
      state: {
        fromQuotation: {
          quotationId: quotation.id,
          customerName: quotation.customer_name,
          // Full Ship To carried through to the sale's own "Sold To"
          // (2026-09-12, CLAUDE.md #50) — previously only the name made it
          // across, so this closes the original "Ship To should carry over"
          // question that started the Quotations feature in the first place.
          customerPhone: quotation.customer_phone,
          customerAddress: quotation.customer_address,
          customerId: quotation.customer_id,
          items: (quotation.items ?? [])
            .filter((it) => it.product_id !== null)
            .map((it) => ({ productId: it.product_id as number, quantity: Number(it.quantity), unitPrice: Number(it.unit_price) })),
        },
      },
    });
  }

  if (loading || !quotation) {
    return <FullPageSpinner />;
  }

  const items = quotation.items ?? [];

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/quotations" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> Back to Quotations
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[quotation.status]}>{quotation.status}</Badge>
          {quotation.status === 'DRAFT' && (
            <Button size="sm" variant="outline" icon={<Send size={14} />} loading={busy} onClick={() => changeStatus('SENT')}>
              Mark as Sent
            </Button>
          )}
          {quotation.status === 'SENT' && (
            <>
              <Button size="sm" variant="outline" icon={<CheckCircle2 size={14} />} loading={busy} onClick={() => changeStatus('ACCEPTED')}>
                Mark as Accepted
              </Button>
              <Button size="sm" variant="outline" icon={<XCircle size={14} />} loading={busy} onClick={() => changeStatus('REJECTED')}>
                Mark as Rejected
              </Button>
            </>
          )}
          {(quotation.status === 'DRAFT' || quotation.status === 'SENT') && (
            <Button size="sm" variant="ghost" icon={<Clock size={14} />} loading={busy} onClick={() => changeStatus('EXPIRED')}>
              Mark as Expired
            </Button>
          )}
          {quotation.status === 'ACCEPTED' && (
            <Button size="sm" icon={<ShoppingCart size={15} />} onClick={convertToSale}>
              Convert to Sale
            </Button>
          )}
          <Button size="sm" variant="outline" icon={<Printer size={15} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {quotation.status === 'CONVERTED' && (
        <div className="no-print mb-4 rounded-lg bg-green-50 px-4 py-2.5 text-[13px] text-green-800">
          Converted to Sale #{quotation.converted_sale_id}.
        </div>
      )}

      <div className="print-area mx-auto max-w-3xl bg-white p-6 text-[#1a1a1a] shadow-card">
        <div className="flex items-start justify-between border-b-2 border-[#185FA5] pb-4">
          <img src="/logo.png" className="h-16 w-16 object-contain" alt="" />
          <div className="text-right text-[12px] text-slate-500">
            <p className="text-base font-bold text-slate-800">{settings?.business_name ?? 'Feed Fusion Tanzania'}</p>
            {settings?.address && <p>{settings.address}</p>}
            {settings?.phone && <p><span className="font-semibold">Tel:</span> {settings.phone}</p>}
            {settings?.email && <p><span className="font-semibold">Email:</span> {settings.email}</p>}
            {settings?.tin && <p><span className="font-semibold">TIN:</span> {settings.tin}</p>}
          </div>
        </div>

        <h1 className="mt-4 text-right text-3xl font-extrabold text-[#185FA5]">QUOTATION</h1>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Ship To</p>
            <p className="mt-1 font-semibold text-slate-800">{quotation.customer_name}</p>
            {quotation.customer_address && <p className="text-[13px] text-slate-500">{quotation.customer_address}</p>}
            {quotation.customer_phone && <p className="text-[13px] text-slate-500">{quotation.customer_phone}</p>}
          </div>
          <div className="min-w-[220px] rounded-lg border border-slate-200 bg-[#F6FAF1] p-3 text-[13px]">
            <p><span className="font-semibold">Quotation No.:</span> {quotation.quotation_number}</p>
            <p><span className="font-semibold">Date:</span> {formatDate(quotation.quotation_date)}</p>
            <p><span className="font-semibold">Valid Until:</span> {quotation.valid_until ? formatDate(quotation.valid_until) : '—'}</p>
            {quotation.reference && <p><span className="font-semibold">Our Ref:</span> {quotation.reference}</p>}
          </div>
        </div>

        <table className="mt-5 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#3B6D11] text-white">
              <th className="px-2.5 py-2 text-left font-semibold">Description</th>
              <th className="px-2.5 py-2 text-right font-semibold">Qty</th>
              <th className="px-2.5 py-2 text-right font-semibold">Unit</th>
              <th className="px-2.5 py-2 text-right font-semibold">Unit Price</th>
              <th className="px-2.5 py-2 text-right font-semibold">Discount</th>
              <th className="px-2.5 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className={idx % 2 === 1 ? 'bg-[#F6FAF1]' : ''}>
                <td className="px-2.5 py-2">{it.description}</td>
                <td className="px-2.5 py-2 text-right">{it.quantity}</td>
                <td className="px-2.5 py-2 text-right">{it.unit ?? '—'}</td>
                <td className="px-2.5 py-2 text-right">{tzs(it.unit_price)}</td>
                <td className="px-2.5 py-2 text-right">{Number(it.discount_pct) > 0 ? `${it.discount_pct}%` : '—'}</td>
                <td className="px-2.5 py-2 text-right font-medium">{tzs(Number(it.quantity) * Number(it.unit_price) * (1 - Number(it.discount_pct) / 100))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div className="flex-1 rounded-lg border border-slate-200 bg-[#F6FAF1] p-3 text-[12.5px]">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Bank Details</p>
            {settings?.bank_account_name || settings?.bank_account_number || settings?.bank_name ? (
              <>
                {settings?.bank_account_name && <p><span className="font-semibold">Account Name:</span> {settings.bank_account_name}</p>}
                {settings?.bank_account_number && <p><span className="font-semibold">Account Number:</span> {settings.bank_account_number}</p>}
                {settings?.bank_name && <p><span className="font-semibold">Bank Name:</span> {settings.bank_name}</p>}
                {/* SWIFT dropped from Bank Details (2026-09-12, CLAUDE.md
                    #51, owner's own instruction while confirming the
                    invoice layout — "ondoa VAT na swift pia") — irrelevant
                    for a domestic NMB transfer, on both this Quotation and
                    the Sale Invoice. `bank_swift` is still saved in
                    Settings and returned by the API; it's just not printed
                    here anymore. */}
                {settings?.bank_branch && <p><span className="font-semibold">Branch:</span> {settings.bank_branch}</p>}
              </>
            ) : (
              <p className="text-slate-400">Not set up yet — add bank details in Settings.</p>
            )}
            {/* Mobile Money (2026-09-12, CLAUDE.md #50/#51) — the two numbers
                the owner gave (+255 676 638 797, +255 753 591 731) already
                show on the Sale receipt's own payment-details box; the
                Quotation printed the same "Bank Details" card without them,
                even though a customer paying against a quotation has the
                same mobile-money option. Only rendered when at least one
                number is actually set in Settings. */}
            {(settings?.mobile_money_1_number || settings?.mobile_money_2_number) && (
              <div className="mt-2 border-t border-slate-200 pt-2">
                {settings?.mobile_money_1_number && (
                  <p><span className="font-semibold">{settings.mobile_money_1_label || 'Mobile Money'}:</span> {settings.mobile_money_1_number}</p>
                )}
                {settings?.mobile_money_2_number && (
                  <p><span className="font-semibold">{settings.mobile_money_2_label || 'Mobile Money'}:</span> {settings.mobile_money_2_number}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 rounded-lg border border-slate-200 p-3 text-[12.5px]">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Notes / Terms</p>
            {/* Falls back to the standard Business Settings terms
                (2026-09-12, CLAUDE.md #54) when this quotation has no note
                of its own — same fallback as the Sale Invoice. */}
            <p className="text-slate-600">{quotation.notes || settings?.invoice_terms || '—'}</p>
          </div>
        </div>

        {/* VAT cell dropped (2026-09-25, owner's request — Quotations no
            longer charge VAT at all). A quotation created before this
            change may still carry a real vat_amount in the database; that
            historical value is simply not re-surfaced here anymore, exactly
            like `bank_swift` above. */}
        <div className="mt-5 grid grid-cols-3 divide-x divide-white/20 rounded-lg bg-[#27500A] text-center text-white">
          <div className="px-2 py-3">
            <p className="text-[11px] uppercase tracking-wide opacity-80">Subtotal</p>
            <p className="font-semibold">{tzs(quotation.subtotal)}</p>
          </div>
          <div className="px-2 py-3">
            <p className="text-[11px] uppercase tracking-wide opacity-80">Discount</p>
            <p className="font-semibold">{tzs(quotation.total_discount)}</p>
          </div>
          <div className="px-2 py-3">
            <p className="text-[11px] uppercase tracking-wide opacity-80">Grand Total</p>
            <p className="font-semibold">{tzs(quotation.total)}</p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-6 text-[12.5px] sm:flex-row sm:justify-between">
          <div>
            <p>Prepared By: {quotation.created_by_name ?? '_________________________'}</p>
            <p className="mt-4">Signature: _________________________</p>
          </div>
          <div>
            <p>Approved By (Customer): _________________________</p>
            <p className="mt-4">Signature: _________________________</p>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] italic text-slate-400">Thank you for your business!</p>
      </div>
    </div>
  );
}
