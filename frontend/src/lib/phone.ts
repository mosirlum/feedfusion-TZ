// Tanzanian phone numbers are written locally as 10 digits starting with 0
// (e.g. 0712345678) — the owner asked to enforce exactly that shape so a
// typo of 9 digits or fewer can't slip through unnoticed (2026-09-11).
// This only checks the digit count/leading zero, not that the prefix
// belongs to a real network.
const TZ_PHONE_RE = /^0\d{9}$/;

export function isValidTzPhone(value: string): boolean {
  return TZ_PHONE_RE.test(value.trim());
}

// Strips anything but digits as the owner types, and caps the length at 10
// so the field can't grow past the valid Tanzanian format by accident.
export function sanitizePhoneInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

export const TZ_PHONE_PLACEHOLDER = '07XXXXXXXX';
export const TZ_PHONE_HINT = 'Tanzania format: 10 digits starting with 0 (e.g. 0712345678).';
export const TZ_PHONE_ERROR = 'Enter a valid 10-digit Tanzania phone number, e.g. 0712345678.';
