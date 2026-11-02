/** Flattens {a:{b:1}} into {'a.b':1} so partial updates never wipe sibling keys. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}
