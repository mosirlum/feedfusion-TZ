import { getBusinessSettings, updateBusinessSettings } from '../db/businessSettingsRepo';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

// Business Settings page (2026-09-12, CLAUDE.md #49) — the very first UI
// for business_settings. Before this, the row existed only from `npm run
// seed` and could never be edited: no route ever called
// businessSettingsRepo.updateBusinessSettings(), which is why every
// Quotation printed real business info as bracketed placeholders in the
// Word template delivered earlier. Read is open to every authenticated
// role (a Quotation's printed header/bank details need it regardless of
// who created the quotation, same as how receipts already show business
// info to any role); only the owner can change it.
export function getSettings() {
  return getBusinessSettings();
}

export async function updateSettings(
  input: Partial<{
    businessName: string;
    phone: string;
    email: string;
    address: string;
    tin: string;
    currency: string;
    defaultMaxDiscountPct: number;
    bankAccountName: string;
    bankAccountNumber: string;
    bankName: string;
    bankSwift: string;
    bankBranch: string;
    vatRatePct: number;
    quotationValidityDays: number;
    mobileMoney1Number: string;
    mobileMoney1Label: string;
    mobileMoney2Number: string;
    mobileMoney2Label: string;
    // Standard invoice/quotation Terms text (2026-09-12, CLAUDE.md #54).
    invoiceTerms: string;
  }>,
  actor: AuthenticatedUser
) {
  if (input.businessName !== undefined && !input.businessName.trim()) {
    throw new HttpError(400, 'BUSINESS_NAME_REQUIRED');
  }
  if (input.vatRatePct !== undefined && (input.vatRatePct < 0 || input.vatRatePct > 100)) {
    throw new HttpError(400, 'VAT_RATE_OUT_OF_RANGE');
  }
  if (input.quotationValidityDays !== undefined && input.quotationValidityDays < 1) {
    throw new HttpError(400, 'QUOTATION_VALIDITY_MUST_BE_POSITIVE');
  }
  const updated = await updateBusinessSettings(input);
  await writeAuditLog({
    userId: actor.id,
    action: 'BUSINESS_SETTINGS_UPDATED',
    entityType: 'business_settings',
    entityId: updated.id,
    details: { fields: Object.keys(input) },
  });
  return updated;
}
