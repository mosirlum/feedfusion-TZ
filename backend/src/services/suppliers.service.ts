import * as suppliersRepo from '../db/suppliersRepo';
import { HttpError } from '../middleware/errorHandler';

export function listSuppliers() {
  return suppliersRepo.listSuppliers();
}

export function createSupplier(input: { name: string; phone?: string; email?: string; address?: string; notes?: string }) {
  if (!input.name) {
    throw new HttpError(400, 'NAME_REQUIRED');
  }
  return suppliersRepo.createSupplier(input);
}

export async function getPurchasesForSupplier(supplierId: number) {
  const supplier = await suppliersRepo.findSupplierById(supplierId);
  if (!supplier) {
    throw new HttpError(404, 'SUPPLIER_NOT_FOUND');
  }
  return suppliersRepo.getPurchasesForSupplier(supplierId);
}

// Suppliers page redesign (2026-09-11) — editing an existing supplier's own
// details. Deliberately narrow: name/phone/email/address/notes/status only
// — the owner chose not to add Business Type / Tax ID / Payment Terms
// fields shown in the reference design, so there's nothing to store for
// those (see CLAUDE.md).
export async function updateSupplier(
  id: number,
  input: { name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; status?: 'active' | 'inactive' }
) {
  const supplier = await suppliersRepo.findSupplierById(id);
  if (!supplier) {
    throw new HttpError(404, 'SUPPLIER_NOT_FOUND');
  }
  if (input.name !== undefined && !input.name.trim()) {
    throw new HttpError(400, 'NAME_REQUIRED');
  }
  return suppliersRepo.updateSupplier(id, input);
}

export function getSupplierStats() {
  return suppliersRepo.getSupplierStats();
}
