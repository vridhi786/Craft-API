/** Normalises an Indian mobile number to 10 digits. Returns null when invalid. */
export function normalizeIndianPhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** wa.me needs international digits only, e.g. 919876543210. */
export const toWhatsAppNumber = (tenDigits) => (tenDigits ? `91${tenDigits}` : '');
