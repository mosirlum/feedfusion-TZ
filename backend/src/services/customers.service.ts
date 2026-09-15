import * as customersRepo from '../db/customersRepo';
import { writeAuditLog } from '../db/auditRepo';
import { HttpError } from '../middleware/errorHandler';
import { AuthenticatedUser } from '../types/auth';

export function listCustomers() {
  return customersRepo.listCustomers();
}

export function searchCustomers(q: string) {
  return customersRepo.searchCustomers(q);
}

export async function createCustomer(
  input: { name: string; phone?: string; email?: string; address?: string; notes?: string },
  actor: AuthenticatedUser
) {
  if (!input.name || !input.name.trim()) {
    throw new HttpError(400, 'NAME_REQUIRED');
  }
  const customer = await customersRepo.createCustomer({ ...input, createdBy: actor.id });
  await writeAuditLog({
    userId: actor.id,
    action: 'CUSTOMER_CREATED',
    entityType: 'customer',
    entityId: customer.id,
    details: { name: customer.name },
  });
  return customer;
}

export async function updateCustomer(
  id: number,
  input: { name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; status?: 'active' | 'inactive' },
  actor: AuthenticatedUser
) {
  const customer = await customersRepo.findCustomerById(id);
  if (!customer) {
    throw new HttpError(404, 'CUSTOMER_NOT_FOUND');
  }
  if (input.name !== undefined && !input.name.trim()) {
    throw new HttpError(400, 'NAME_REQUIRED');
  }
  const updated = await customersRepo.updateCustomer(id, input);
  await writeAuditLog({
    userId: actor.id,
    action: 'CUSTOMER_UPDATED',
    entityType: 'customer',
    entityId: id,
    details: { name: updated.name },
  });
  return updated;
}
