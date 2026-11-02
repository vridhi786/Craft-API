const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Input hygiene: drops keys starting with "$" or containing "." (defence in depth; all DB access is parameterised through PostgREST). */
export function stripOperatorKeys(value) {
  if (Array.isArray(value)) { value.forEach(stripOperatorKeys); return value; }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) delete value[key];
      else stripOperatorKeys(value[key]);
    }
  }
  return value;
}

export function sanitizeRequest(req, _res, next) {
  stripOperatorKeys(req.body);
  stripOperatorKeys(req.query);
  stripOperatorKeys(req.params);
  next();
}

/** Trims, strips HTML tags and control characters from free text. */
export function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}
