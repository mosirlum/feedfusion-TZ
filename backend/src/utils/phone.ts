// Same Tanzania phone shape enforced on the frontend (frontend/src/lib/phone.ts)
// — 10 digits, starting with 0 (e.g. 0712345678). Checked again here so a
// request that bypasses the frontend (a different client, a direct API call)
// can't slip a mistyped 9-digit number into the database.
const TZ_PHONE_RE = /^0\d{9}$/;

export function isValidTzPhone(value: string): boolean {
  return TZ_PHONE_RE.test(value.trim());
}
