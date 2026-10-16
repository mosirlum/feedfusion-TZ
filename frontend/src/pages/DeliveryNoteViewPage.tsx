import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft, CheckCircle2, XCircle, Link2, Undo2, Trash2 } from 'lucide-react';
import { deliveryNotesApi, settingsApi, apiErrorMessage } from '../lib/api';
import { DeliveryNote, BusinessSettings, DeliveryNoteStatus } from '../types';
import { formatDate } from '../lib/format';
import { Badge, Button, FullPageSpinner, Input, Modal } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';

// Delivery Note view/print page (2026-10-16) — same document family as the
// Quotation and Sale Invoice (logo + business header, blue title, green
// items table) so all three read as one set. Quantities only: a delivery
// note deliberately prints NO prices, discounts, VAT or totals. Uses the
// existing .print-area/.no-print convention (see index.css).
const STATUS_TONE: Record<DeliveryNoteStatus, 'blue' | 'green' | 'red'> = {
  ISSUED: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'red',
};

export default function DeliveryNoteViewPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<DeliveryNote | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invoiceInput, setInvoiceInput] = useState('');

  function load() {
    if (!id) return;
    setLoading(true);
    Promise.all([deliveryNotesApi.get(Number(id)), settingsApi.get()])
      .then(([noteRes, settingsRes]) => {
        setNote(noteRes.data);
        setSettings(settingsRes.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load this delivery note.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function changeStatus(status: DeliveryNoteStatus, message: string) {
    if (!note) return;
    setBusy(true);
    try {
      const res = await deliveryNotesApi.updateStatus(note.id, status);
      setNote(res.data);
      toast.success(message);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update the status.'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote() {
    if (!note) return;
    setBusy(true);
    try {
      await deliveryNotesApi.remove(note.id);
      toast.success(`${note.delivery_note_number} deleted.`);
      navigate('/delivery-notes');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete the delivery note.'));
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  async function linkInvoice(invoiceNumber: string | null) {
    if (!note) return;
    setBusy(true);
    try {
      const res = await deliveryNotesApi.linkSale(note.id, invoiceNumber);
      setNote(res.data);
      setInvoiceInput('');
      toast.success(invoiceNumber ? `Linked to ${invoiceNumber}.` : 'Invoice link removed.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not link the invoice.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !note) {
    return <FullPageSpinner />;
  }

  const items = note.items ?? [];
  const totalQty = items.reduce((sum, it) => sum + Number(it.quantity), 0);

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/delivery-notes" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> Back to Delivery Notes
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[note.status]}>{note.status}</Badge>
          {note.status === 'ISSUED' && (
            <>
              <Button size="sm" variant="outline" icon={<CheckCircle2 size={14} />} loading={busy} onClick={() => changeStatus('DELIVERED', 'Marked as delivered.')}>
                Mark as Delivered
              </Button>
              <Button size="sm" variant="ghost" icon={<XCircle size={14} />} loading={busy} onClick={() => changeStatus('CANCELLED', 'Delivery note cancelled.')}>
                Cancel
              </Button>
            </>
          )}
          {note.status === 'DELIVERED' && (
            <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} loading={busy} onClick={() => changeStatus('ISSUED', 'Moved back to issued.')}>
              Undo Delivered
            </Button>
          )}
          {note.status === 'CANCELLED' && isOwner && (
            <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
          <Button size="sm" variant="outline" icon={<Printer size={15} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {note.status !== 'CANCELLED' && (
        <div className="no-print mb-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-[13px] dark:border-[rgba(255,255,255,0.14)] dark:bg-[#121a16] sm:flex-row sm:items-center">
          <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-[#d2dbd5]">
            <Link2 size={14} /> Linked invoice:
          </span>
          {note.linked_invoice_number ? (
            <>
              <span className="font-medium text-slate-800 dark:text-[#eef3ef]">{note.linked_invoice_number}</span>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => linkInvoice(null)}>
                Remove link
              </Button>
            </>
          ) : (
            <>
              <span className="text-slate-400 dark:text-[#77857c]">None yet — add the invoice number once the sale is completed.</span>
              <div className="flex gap-2 sm:ml-auto">
                <Input
                  value={invoiceInput}
                  onChange={(e) => setInvoiceInput(e.target.value)}
                  placeholder="INV-2026-0001"
                  className="sm:w-48"
                />
                <Button size="sm" variant="outline" loading={busy} disabled={!invoiceInput.trim()} onClick={() => linkInvoice(invoiceInput.trim())}>
                  Link
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="print-area relative mx-auto max-w-3xl bg-white p-6 text-[#1a1a1a] shadow-card">
        {note.status === 'CANCELLED' && (
          <p className="pointer-events-none absolute right-6 top-24 rotate-[-8deg] rounded border-2 border-red-500 px-3 py-1 text-xl font-extrabold uppercase tracking-widest text-red-500">
            Cancelled
          </p>
        )}
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

        <h1 className="mt-4 text-right text-3xl font-extrabold text-[#185FA5]">DELIVERY NOTE</h1>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Deliver To</p>
            <p className="mt-1 font-semibold text-slate-800">{note.customer_name}</p>
            {note.delivery_address && <p className="text-[13px] text-slate-500">{note.delivery_address}</p>}
            {note.customer_phone && <p className="text-[13px] text-slate-500">{note.customer_phone}</p>}
          </div>
          <div className="min-w-[220px] rounded-lg border border-slate-200 bg-[#F6FAF1] p-3 text-[13px]">
            <p><span className="font-semibold">Delivery Note No.:</span> {note.delivery_note_number}</p>
            <p><span className="font-semibold">Date:</span> {formatDate(note.delivery_date)}</p>
            {note.linked_invoice_number && <p><span className="font-semibold">Invoice No.:</span> {note.linked_invoice_number}</p>}
            {note.reference && <p><span className="font-semibold">Our Ref:</span> {note.reference}</p>}
          </div>
        </div>

        <table className="mt-5 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#3B6D11] text-white">
              <th className="w-10 px-2.5 py-2 text-left font-semibold">#</th>
              <th className="px-2.5 py-2 text-left font-semibold">Description</th>
              <th className="px-2.5 py-2 text-right font-semibold">Qty</th>
              <th className="px-2.5 py-2 text-right font-semibold">Unit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className={idx % 2 === 1 ? 'bg-[#F6FAF1]' : ''}>
                <td className="px-2.5 py-2 text-slate-500">{idx + 1}</td>
                <td className="px-2.5 py-2">{it.description}</td>
                <td className="px-2.5 py-2 text-right font-medium">{Number(it.quantity)}</td>
                <td className="px-2.5 py-2 text-right">{it.unit ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end">
          <div className="rounded-lg bg-[#27500A] px-5 py-2.5 text-center text-white">
            <p className="text-[11px] uppercase tracking-wide opacity-80">Total quantity</p>
            <p className="font-semibold">{totalQty}</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 p-3 text-[12.5px]">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Notes</p>
          <p className="text-slate-600">{note.notes || '—'}</p>
        </div>

        <p className="mt-4 text-[12px] text-slate-500">
          Goods received in good order and condition. No prices are shown on this delivery note.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 text-[12.5px] sm:grid-cols-2">
          <div>
            <p>Issued By: {note.created_by_name ?? '____________________'}</p>
            <p className="mt-4">Signature: _________________________</p>
            <p className="mt-4">Date: _________________________</p>
          </div>
          <div>
            <p>Received By: _________________________</p>
            <p className="mt-4">Signature: _________________________</p>
            <p className="mt-4">Date: _________________________</p>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] italic text-slate-400">Thank you for your business!</p>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete delivery note"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={deleteNote}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-[#b6c2ba]">
          {note.delivery_note_number} for {note.customer_name} will be removed for good. Stock and sales are not affected.
          The deletion is recorded in the Audit Log.
        </p>
      </Modal>
    </div>
  );
}
