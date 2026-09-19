import { useEffect, useState } from 'react';
import { salesApi, apiErrorMessage } from '../lib/api';
import { tzs, formatDateTime } from '../lib/format';
import { Spinner } from './ui';
import { useToast } from './ui/Toast';

interface ReceiptData {
  invoice_number: string;
  sale_date: string;
  served_by_name: string;
  customer_name_or_walkin: string;
  customer_phone: string | null;
  customer_address: string | null;
  items: Array<{
    product_name: string;
    unit: string | null;
    quantity: number;
    unit_price: string;
    line_subtotal: string;
    discount_amount: string;
    discount_reason: string | null;
  }>;
  subtotal: string;
  total_discount: string;
  total: string;
  status: string;
  // Credit sales (2026-09-12, CLAUDE.md #50).
  payment_status: 'PAID' | 'PARTIAL';
  amount_paid: string;
  balance_due: string;
  payments: Array<{ amount: string; method: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY'; created_at: string }>;
  business_name: string;
  business_address: string | null;
  business_phone: string | null;
  business_email: string | null;
  business_tin: string | null;
  notes: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_name: string | null;
  bank_swift: string | null;
  bank_branch: string | null;
  mobile_money_1_number: string | null;
  mobile_money_1_label: string | null;
  mobile_money_2_number: string | null;
  mobile_money_2_label: string | null;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  MOBILE_MONEY: 'Mobile Money',
};

// Invoice layout redesigned 2026-09-12 (CLAUDE.md #51) to match the
// QUOTATION Word template the owner confirmed as "the format we agreed
// upon": logo top-left / business header top-right, a big blue document
// title, a Sold To + meta-details row, a dark-green items table, a
// Bank Details + Notes/Terms row, and a dark-green totals bar. Two
// deliberate differences from the Quotation, both confirmed with the
// owner rather than assumed: no VAT column (sales don't track VAT at all —
// that was an explicit MVP scope decision, CLAUDE.md #33 — only Quotations
// do), and no SWIFT line in Bank Details (dropped from both documents,
// domestic transfers don't need it). Also, deliberately, no "Prepared
// By / Approved By" signature lines — the owner asked for those to be
// removed from the invoice entirely earlier in this project ("ondoa
// kabisa") and that stands; only the Quotation (a document the customer
// countersigns) keeps them.
export function ReceiptView({ saleId }: { saleId: number }) {
  const [data, setData] = useState<ReceiptData | null>(null);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    salesApi
      .receipt(saleId)
      .then((res) => active && setData(res.data as ReceiptData))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load the receipt.')));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  if (!data) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const hasDiscountReasons = data.items.some((i) => Number(i.discount_amount) > 0 && i.discount_reason);
  const hasBankDetails = data.bank_account_name || data.bank_account_number || data.bank_name;
  const hasMobileMoney = data.mobile_money_1_number || data.mobile_money_2_number;

  return (
    <div className="print-area-modal mx-auto max-w-3xl bg-white p-6 text-[13px] text-[#1a1a1a]">
      <div className="flex items-start justify-between border-b-2 border-[#185FA5] pb-4">
        <img src="/logo.png" className="h-24 w-24 object-contain" alt="" />
        <div className="text-right text-[12px] text-slate-500">
          <p className="text-base font-bold text-slate-800">{data.business_name}</p>
          {data.business_address && <p>{data.business_address}</p>}
          {data.business_phone && <p><span className="font-semibold">Tel:</span> {data.business_phone}</p>}
          {data.business_email && <p><span className="font-semibold">Email:</span> {data.business_email}</p>}
          {data.business_tin && <p><span className="font-semibold">TIN:</span> {data.business_tin}</p>}
        </div>
      </div>

      <h1 className="mt-4 text-right text-3xl font-extrabold text-[#185FA5]">INVOICE</h1>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Sold To</p>
          <p className="mt-1 font-semibold text-slate-800">{data.customer_name_or_walkin}</p>
          {data.customer_phone && <p className="text-[13px] text-slate-500">{data.customer_phone}</p>}
          {data.customer_address && <p className="text-[13px] text-slate-500">{data.customer_address}</p>}
        </div>
        <div className="min-w-[220px] rounded-lg border border-slate-200 bg-[#F6FAF1] p-3 text-[13px]">
          <p><span className="font-semibold">Invoice No.:</span> {data.invoice_number}</p>
          <p><span className="font-semibold">Date:</span> {formatDateTime(data.sale_date)}</p>
          <p><span className="font-semibold">Served By:</span> {data.served_by_name}</p>
        </div>
      </div>

      <table className="mt-5 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-[#3B6D11] text-white">
            <th className="px-2.5 py-2 text-left font-semibold">No.</th>
            <th className="px-2.5 py-2 text-left font-semibold">Item</th>
            <th className="px-2.5 py-2 text-right font-semibold">Qty</th>
            <th className="px-2.5 py-2 text-right font-semibold">Unit Price</th>
            <th className="px-2.5 py-2 text-right font-semibold">Discount</th>
            <th className="px-2.5 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, idx) => {
            const pct = Number(item.discount_amount) > 0 && Number(item.line_subtotal) > 0
              ? (Number(item.discount_amount) / Number(item.line_subtotal)) * 100
              : 0;
            return (
              <tr key={idx} className={idx % 2 === 1 ? 'bg-[#F6FAF1]' : ''}>
                <td className="px-2.5 py-2">{idx + 1}</td>
                <td className="px-2.5 py-2">{item.product_name}</td>
                <td className="px-2.5 py-2 text-right">{item.quantity}</td>
                <td className="px-2.5 py-2 text-right">{tzs(item.unit_price)}</td>
                <td className="px-2.5 py-2 text-right">{pct > 0 ? `${pct.toFixed(1)}%` : '—'}</td>
                <td className="px-2.5 py-2 text-right font-medium">{tzs(item.line_subtotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Per-line discount reasons (BR-30 accountability) — the Quotation's
          own Discount column has no reason to show since a quotation's
          discount isn't approval-gated the way a sale's is; kept here as a
          compact footnote rather than dropped, since it's real audit-trail
          information specific to a completed sale. */}
      {hasDiscountReasons && (
        <div className="mt-1 text-[11px] text-[#185FA5]">
          {data.items
            .filter((i) => Number(i.discount_amount) > 0 && i.discount_reason)
            .map((i, idx) => (
              <p key={idx}>{i.product_name}: {i.discount_reason}</p>
            ))}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="flex-1 rounded-lg border border-slate-200 bg-[#F6FAF1] p-3 text-[12.5px]">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Bank Details</p>
          {hasBankDetails ? (
            <>
              {data.bank_account_name && <p><span className="font-semibold">Account Name:</span> {data.bank_account_name}</p>}
              {data.bank_account_number && <p><span className="font-semibold">Account Number:</span> {data.bank_account_number}</p>}
              {data.bank_name && <p><span className="font-semibold">Bank Name:</span> {data.bank_name}</p>}
              {data.bank_branch && <p><span className="font-semibold">Branch:</span> {data.bank_branch}</p>}
            </>
          ) : (
            <p className="text-slate-400">Not set up yet — add bank details in Settings.</p>
          )}
          {hasMobileMoney && (
            <div className="mt-2 border-t border-slate-200 pt-2">
              {data.mobile_money_1_number && (
                <p><span className="font-semibold">{data.mobile_money_1_label || 'Mobile Money'}:</span> {data.mobile_money_1_number}</p>
              )}
              {data.mobile_money_2_number && (
                <p><span className="font-semibold">{data.mobile_money_2_label || 'Mobile Money'}:</span> {data.mobile_money_2_number}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 rounded-lg border border-slate-200 p-3 text-[12.5px]">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Notes / Terms</p>
          <p className="text-slate-600">{data.notes || '—'}</p>
        </div>
      </div>

      {/* No VAT column here — sales don't track VAT at all (an explicit
          MVP scope decision, CLAUDE.md #33); only Quotations do. Confirmed
          with the owner when redesigning this layout (CLAUDE.md #51) rather
          than assumed. */}
      <div className="mt-5 grid grid-cols-3 divide-x divide-white/20 rounded-lg bg-[#27500A] text-center text-white">
        <div className="px-2 py-3">
          <p className="text-[11px] uppercase tracking-wide opacity-80">Subtotal</p>
          <p className="font-semibold">{tzs(data.subtotal)}</p>
        </div>
        <div className="px-2 py-3">
          <p className="text-[11px] uppercase tracking-wide opacity-80">Discount</p>
          <p className="font-semibold">{tzs(data.total_discount)}</p>
        </div>
        <div className="px-2 py-3">
          <p className="text-[11px] uppercase tracking-wide opacity-80">Grand Total</p>
          <p className="font-semibold">{tzs(data.total)}</p>
        </div>
      </div>

      {/* Payment status/breakdown — a completed sale has real payment
          facts a mere Quotation never has, so this sits below the totals
          bar as its own section rather than trying to force it into the
          Quotation's layout. */}
      <div className="mt-4 flex items-center justify-between rounded bg-[#EAF3DE] px-3 py-2.5 font-bold text-[#27500A]">
        <span>{data.status === 'VOIDED' ? 'VOIDED' : data.payment_status === 'PARTIAL' ? 'PARTIALLY PAID' : 'PAID IN FULL'}</span>
        <span>{tzs(data.total)}</span>
      </div>

      {data.status !== 'VOIDED' && (
        <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
          {data.payments.map((p, i) => (
            <div key={i} className="flex justify-between">
              <span>Paid via {PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
              <span>{tzs(p.amount)}</span>
            </div>
          ))}
          {Number(data.balance_due) > 0 && (
            <div className="flex justify-between font-semibold text-[#A32D2D]">
              <span>Balance Due</span>
              <span>{tzs(data.balance_due)}</span>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
        Thank you for choosing Feed Fusion Tanzania!
      </p>
    </div>
  );
}
