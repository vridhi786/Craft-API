/**
 * One-time administrator provisioning.
 *   1. Put ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD (+ the Supabase variables) in your environment / .env
 *   2. npm run create-admin
 *   3. Remove ADMIN_PASSWORD from the environment afterwards.
 * There is deliberately no default password and no public registration endpoint.
 */
import { env } from '../config/environment.js';
import { supabase } from '../config/supabase.js';
import { passwordPolicy } from '../validators/authValidator.js';
import { hashPassword } from '../utils/password.js';

const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

async function main() {
  if (!env.supabaseUrl || !env.supabaseKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first');
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD first (see .env.example)');
  const parsed = passwordPolicy.safeParse(ADMIN_PASSWORD);
  if (!parsed.success) throw new Error(`Weak password: ${parsed.error.issues[0].message}`);

  const email = ADMIN_EMAIL.toLowerCase().trim();
  const { data: existing, error: readErr } = await supabase.from('admins').select('id').eq('email', email).maybeSingle();
  if (readErr) throw new Error(`Could not reach the admins table (${readErr.message}). Did you run supabase/schema.sql?`);
  if (existing) throw new Error(`An admin with email ${email} already exists`);

  const { error } = await supabase.from('admins').insert({ name: ADMIN_NAME.trim(), email, password_hash: await hashPassword(ADMIN_PASSWORD), role: 'super_admin' });
  if (error) throw new Error(error.message);
  console.log(`Super admin created: ${email}\nNow remove ADMIN_PASSWORD from your environment/.env file.`);
}

main().catch((err) => { console.error(`Failed: ${err.message}`); process.exitCode = 1; });
