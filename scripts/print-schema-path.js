import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
console.log(`Paste this file into Supabase → SQL Editor and run it once:\n  ${join(dirname(fileURLToPath(import.meta.url)), '../supabase/schema.sql')}`);
