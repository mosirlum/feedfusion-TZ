import { FormEvent, useEffect, useState } from 'react';
import { customersApi, apiErrorMessage } from '../lib/api';
import { Customer } from '../types';
import { Button, FormField, Input, Modal, Select, Textarea } from './ui';
import { useToast } from './ui/Toast';
import { isValidTzPhone, sanitizePhoneInput, TZ_PHONE_PLACEHOLDER, TZ_PHONE_HINT, TZ_PHONE_ERROR } from '../lib/phone';

// Shared create/edit modal for a Customer — used by both the Customers page
// and the Quotation form's inline "+ Add new customer" action (2026-09-12,
// Quotations feature, CLAUDE.md #49). Mirrors SuppliersPage.tsx's
// SupplierFormModal almost exactly, since the two entities are structurally
// the same on this schema.
export function CustomerFormModal({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: Customer | null;
  onSaved: (c: Customer) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setPhone(editing?.phone ?? '');
      setEmail(editing?.email ?? '');
      setAddress(editing?.address ?? '');
      setNotes(editing?.notes ?? '');
      setStatus(editing?.status ?? 'active');
    }
  }, [open, editing]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (phone.trim() && !isValidTzPhone(phone)) {
      toast.error(TZ_PHONE_ERROR);
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const res = await customersApi.update(editing.id, {
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          status,
        });
        toast.success('Customer updated.');
        onSaved(res.data);
      } else {
        const res = await customersApi.create({
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        toast.success('Customer added.');
        onSaved(res.data);
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, editing ? 'Could not update this customer.' : 'Could not create customer.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New Customer'} size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Phone" hint={TZ_PHONE_HINT}>
          <Input
            placeholder={TZ_PHONE_PLACEHOLDER}
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
          />
        </FormField>
        <FormField label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label="Address">
          <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, country" />
        </FormField>
        <FormField label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {editing && (
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </FormField>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
