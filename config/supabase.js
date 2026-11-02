import { createClient } from '@supabase/supabase-js';
import { env } from './environment.js';

let client;

/** Lazily creates the single Supabase client (server-side: no session persistence, no token refresh). */
export function getSupabase() {
  if (!client) {
    if (!env.supabaseUrl || !env.supabaseKey) throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    client = createClient(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      db: { schema: 'public' },
      global: { headers: { 'x-application-name': 'crafters-workshop-api' } },
    });
  }
  return client;
}

/** `import { supabase }` anywhere; the client is created on first use so unit tests don't need credentials. */
export const supabase = new Proxy({}, {
  get(_target, prop) {
    const real = getSupabase();
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

/** Cheap connectivity probe for /health and start-up. Never throws. */
export async function checkDatabase(timeoutMs = 4000) {
  try {
    const probe = supabase.from('site_settings').select('id', { head: true, count: 'exact' }).limit(1);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
    const { error } = await Promise.race([probe, timeout]);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
