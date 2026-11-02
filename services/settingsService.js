import { supabase } from '../config/supabase.js';
import { siteDefaults, deepMerge, PUBLIC_SETTINGS_FIELDS } from '../config/siteDefaults.js';
import { run } from '../utils/dbError.js';

// Settings are read on every quote/order/page load: keep a short in-process cache (invalidated on save).
const TTL_MS = 5000;
let cache = null;
let cachedAt = 0;

/** Test helper: forget the cached settings. */
export const clearSettingsCache = () => { cache = null; cachedAt = 0; };

/** Returns the merged settings object (defaults ← stored). */
export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return cache;
  const { data } = await run(supabase.from('site_settings').select('data').eq('key', 'main').maybeSingle());
  cache = deepMerge(siteDefaults(), data?.data || {});
  cachedAt = Date.now();
  return cache;
}

/** Deep-merges a partial update over the stored settings and saves it. Returns the new merged settings. */
export async function saveSettings(patch) {
  const { data } = await run(supabase.from('site_settings').select('data').eq('key', 'main').maybeSingle());
  const next = deepMerge(data?.data || {}, patch);
  await run(supabase.from('site_settings').upsert({ key: 'main', data: next }, { onConflict: 'key' }));
  cache = null;
  return getSettings({ fresh: true });
}

export function toPublicSettings(settings) {
  const out = {};
  for (const key of PUBLIC_SETTINGS_FIELDS) out[key] = settings[key];
  return out;
}
