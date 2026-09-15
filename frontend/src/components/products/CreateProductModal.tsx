import { FormEvent, useEffect, useState } from 'react';
import { categoriesApi, productsApi, apiErrorMessage } from '../../lib/api';
import { Category } from '../../types';
import { Button, FormField, Input, Modal, Select } from '../ui';
import { useToast } from '../ui/Toast';

// Extracted out of ProductsPage.tsx (2026-09-11, Inventory page redesign) so
// the Inventory page's "Add Product" button can open the exact same form
// instead of a second, drifting copy of it.
export function CreateProductModal({
  open,
  categories,
  onClose,
  onCreated,
  onCategoryCreated,
}: {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
  onCategoryCreated: (category: Category) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [unit, setUnit] = useState('kg');
  const [minimumStock, setMinimumStock] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setCategoryId('');
      setUnit('kg');
      setMinimumStock('0');
      setAddingCategory(false);
      setNewCategoryName('');
    }
  }, [open]);

  async function handleCreateCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setCreatingCategory(true);
    try {
      const res = await categoriesApi.create({ name: trimmed });
      onCategoryCreated(res.data);
      setCategoryId(String(res.data.id));
      setAddingCategory(false);
      setNewCategoryName('');
      toast.success(`Category "${res.data.name}" added.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create this category.'));
    } finally {
      setCreatingCategory(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await productsApi.create({
        name: name.trim(),
        categoryId: categoryId ? Number(categoryId) : null,
        unit: unit.trim(),
        minimumStock: Number(minimumStock) || 0,
      });
      toast.success('Product created. Set a selling price before it can be sold.');
      onCreated();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create the product.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Product" size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Product name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Category" hint='e.g. "Poultry Feed" or "Fish Feed" — not in the list? Add it below.'>
          {!addingCategory ? (
            <div className="flex items-center gap-2">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="flex-1">
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCategory(true)}>
                + New
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                placeholder="New category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateCategory();
                  }
                }}
              />
              <Button type="button" size="sm" loading={creatingCategory} onClick={handleCreateCategory}>
                Add
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setAddingCategory(false); setNewCategoryName(''); }}>
                Cancel
              </Button>
            </div>
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, bag, litre…" required />
          </FormField>
          <FormField label="Minimum stock (alert level)">
            <Input type="number" min={0} value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} />
          </FormField>
        </div>
        <p className="text-xs text-slate-400 dark:text-[#77857c]">
          New products have no selling price yet — a price proposal must be approved before this product can be
          sold (BR-27).
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create Product
          </Button>
        </div>
      </form>
    </Modal>
  );
}
