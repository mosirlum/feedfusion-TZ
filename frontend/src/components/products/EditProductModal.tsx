import { FormEvent, useEffect, useState } from 'react';
import { productsApi, apiErrorMessage } from '../../lib/api';
import { Category, Product } from '../../types';
import { Button, FormField, Input, Modal, Select } from '../ui';
import { useToast } from '../ui/Toast';

// Edit Product (2026-09-19, CLAUDE.md #69) — added because there was no way
// to fix a product's own data after creation (only create + activate/
// deactivate existed). Root cause of a real complaint: a product created
// with a plain number typed into "Unit" instead of a unit label (e.g. "14"
// instead of "kg") had no way to be corrected, so the wrong value kept
// printing on every invoice. Mirrors CreateProductModal's fields (name,
// category, unit, minimum stock) but pre-filled and PATCHing instead of
// POSTing; price is deliberately not editable here — that still goes
// through the existing Price Proposal flow (BR-27), unchanged.
export function EditProductModal({
  open,
  product,
  categories,
  onClose,
  onUpdated,
}: {
  open: boolean;
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [unit, setUnit] = useState('');
  const [minimumStock, setMinimumStock] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && product) {
      setName(product.name);
      setCategoryId(product.category_id != null ? String(product.category_id) : '');
      setUnit(product.unit);
      setMinimumStock(String(product.minimum_stock ?? 0));
    }
  }, [open, product]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!product) return;
    setSubmitting(true);
    try {
      await productsApi.update(product.id, {
        name: name.trim(),
        categoryId: categoryId ? Number(categoryId) : null,
        unit: unit.trim(),
        minimumStock: Number(minimumStock) || 0,
      });
      toast.success('Product updated.');
      onUpdated();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update this product.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Product" size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Product name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unit" hint="kg, bag, litre… never a number.">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, bag, litre…" required />
          </FormField>
          <FormField label="Minimum stock (alert level)">
            <Input type="number" min={0} value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} />
          </FormField>
        </div>
        <p className="text-xs text-slate-400 dark:text-[#77857c]">
          Selling price isn't edited here — use a Price Proposal (BR-27) to change it.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
