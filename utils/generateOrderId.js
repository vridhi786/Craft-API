import { randomInt } from 'node:crypto';

// Crockford-style alphabet without ambiguous characters. The random suffix makes IDs non-enumerable.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export function generateOrderId(date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `CW-${yy}${mm}${dd}-${suffix}`;
}
