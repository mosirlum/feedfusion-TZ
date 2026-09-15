import { FormEvent, useEffect, useState } from 'react';
import { productsApi, apiErrorMessage } from '../../lib/api';
import { tzs } from '../../lib/format';
import { Button, FormField, Input, Modal, Textarea } from '../ui';
import { useToast } from '../ui/Toast';

// Extracted out of ProductsPage.tsx (2026-09-11, Inventory page redesign) so
// the Inventory page's "Set price" row action can reuse this exact form
// instead of a second, drifting copy of it. Deliberately takes only the
// three fields this form actually needs (not the full Product type) so a
// caller like InventoryPage — whose rows are InventoryRow, not Product —
// doesn't need to fabricate an entire Product object just to open it.
export function ProposePriceModal({
  product,
  isOwner,
  onClose,
  onDone,
}: {
  product: { id: number; name: string; active_price: string | null } | null;
  isOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (product) {
      setPrice(product.active_price ?? '');
      setNotes('');
    }
  }, [product]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!product) return;
    setSubmitting(true);
    try {
      await productsApi.submitProposal(product.id, { proposedPrice: Number(price), notes: notes.trim() || undefined });
      toast.success(isOwner ? 'Price updated.' : 'Price proposed — awaiting owner approval.');
      onDone();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not submit the price.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={product !== null} onClose={onClose} title={`${isOwner ? 'Set' : 'Propose'} price — ${product?.name ?? ''}`} size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Price (TZS)" hint={product?.active_price ? `Current: ${tzs(product.active_price)}` : 'No approved price yet.'}>
          <Input type="number" min={0} step="1" value={price} onChange={(e) => setPrice(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {!isOwner && (
          <p className="text-xs text-slate-400 dark:text-[#77857c]">
            This will be sent to the owner for approval and won't affect the sale price until approved.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isOwner ? 'Update Price' : 'Submit Proposal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
