const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Recursively merges `over` onto `base` (plain objects only; arrays and scalars replace). Returns a new object. */
export function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
