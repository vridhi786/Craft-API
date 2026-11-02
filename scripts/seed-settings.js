/** Creates the site-settings row with brand defaults (no products or fake content). Safe to run repeatedly. */
import { env } from '../config/environment.js';
import { supabase } from '../config/supabase.js';
import { getSettings } from '../services/settingsService.js';

async function main() {
  if (!env.supabaseUrl || !env.supabaseKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first');
  const { data, error } = await supabase.from('site_settings').select('id').eq('key', 'main').maybeSingle();
  if (error) throw new Error(`${error.message} (did you run supabase/schema.sql?)`);
  if (!data) {
    const { error: insErr } = await supabase.from('site_settings').insert({ key: 'main', data: {} });
    if (insErr) throw new Error(insErr.message);
  }
  const s = await getSettings({ fresh: true });
  console.log(`Settings ready for "${s.brandName}" (WhatsApp: ${s.whatsappNumber || 'not set'})`);
}

main().catch((err) => { console.error(`Failed: ${err.message}`); process.exitCode = 1; });
