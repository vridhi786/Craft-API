/**
 * Generates ../website/sitemap.xml from the live database (active products and categories).
 * Run after adding products:  SITE_URL=https://www.yourdomain.com npm run sitemap
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/environment.js';
import { supabase } from '../config/supabase.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const STATIC = ['', 'shop.html', 'offers.html', 'about.html', 'contact.html', 'faq.html', 'order-tracking.html', 'shipping-policy.html', 'return-refund-policy.html', 'privacy-policy.html', 'terms-and-conditions.html'];

async function all(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('slug, updated_at').eq('is_active', true).eq('is_archived', false).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function main() {
  if (!env.siteUrl) throw new Error('Set SITE_URL (e.g. https://www.yourdomain.com)');
  if (!env.supabaseUrl || !env.supabaseKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const [products, categories] = await Promise.all([all('products'), all('categories')]);
  const url = (loc, lastmod) => `  <url><loc>${esc(`${env.siteUrl}/${loc}`)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  const lines = [
    ...STATIC.map((p) => url(p)),
    ...categories.map((c) => url(`category.html?slug=${c.slug}`, c.updated_at)),
    ...products.map((p) => url(`product.html?slug=${p.slug}`, p.updated_at)),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
  const out = join(dirname(fileURLToPath(import.meta.url)), '../../website/sitemap.xml');
  writeFileSync(out, xml);
  console.log(`Wrote ${lines.length} URLs to ${out}`);
}

main().catch((err) => { console.error(`Failed: ${err.message}`); process.exitCode = 1; });
