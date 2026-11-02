# The Crafters Workshop – API

Node.js 20+ · Express 4 · **Supabase (PostgreSQL)** via `@supabase/supabase-js` · REST under `/api/v1` · ES modules.

## 1. Quick start
```bash
npm install
copy .env.example .env      # macOS/Linux: cp     → fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, FRONTEND_ORIGIN, CLOUDINARY_*
# 1) create the tables: Supabase Dashboard → SQL Editor → paste supabase/schema.sql → Run   (once)
npm run create-admin        # one-time super-admin (set ADMIN_NAME/EMAIL/PASSWORD in .env first, then delete the password)
npm run dev                 # http://localhost:5000/api/v1/health
```

## 2. Supabase setup (step by step)
1. https://supabase.com → **New project** (note the database password; choose a region near your customers).
2. **SQL Editor → New query** → paste the whole of `supabase/schema.sql` → **Run**. It creates 20 tables, 1 view, 15 functions, indexes, constraints and security rules. Run it once on an empty project.
3. **Project Settings → API**: copy **Project URL** → `SUPABASE_URL`, and the **`service_role` secret key** → `SUPABASE_SERVICE_ROLE_KEY`.
   *The `service_role` key bypasses Row Level Security – it belongs only on the API server (Render env vars / `.env`). Never in `website/`, never committed.*
4. Start the API: the log says “Supabase connected” and `/health` shows `"database":"up"`. If it says “down”, the schema wasn’t applied or the key is wrong.
5. **Security model:** RLS is enabled on every table with **no policies**, and privileges are revoked from `anon`/`authenticated`. So even though the project URL and anon key are public by design, nobody can read or write data except through this API.

### Tables checklist (all created by `schema.sql`)
| Table | Purpose / key columns | Foreign keys |
|---|---|---|
| `admins` | name, unique lower(email), password_hash, role, lockout fields | – |
| `categories` | name, unique slug, `level` 1–3, `parent_id`, image(jsonb), display_order, is_active/is_archived | `parent_id → categories` (restrict) |
| `products` | name, unique slug & sku, price, discount_price (< price), stock, stock_status*, min_price*, search_text*, images/custom_fields/specifications (jsonb), flags | `category_id`, `subcategory_id`, `child_category_id → categories` (restrict) |
| `product_variants` | label (unique per product), price, discount_price, stock, is_active | `product_id → products` (cascade) |
| `customers` | unique phone, name, email, order_count, total_order_value | – |
| `coupons` | unique code, type, value, min_cart_amount, max_discount, dates, usage_limit, per_customer_limit, used_count | – |
| `coupon_products`, `coupon_categories` | many-to-many restrictions | → coupons, products / categories (cascade) |
| `offers`, `offer_products`, `offer_categories` | promotions + links | → products / categories (cascade) |
| `banners` | title, image, schedule, order | `product_id`, `category_id` (set null) |
| `orders` | unique order_id (public ref), unique idempotency_key, customer_*, address(jsonb), totals, status, payment_status, amount_collected | – |
| `order_items` | **snapshots** of name/sku/price/customisations, quantity, tracked | `order_id → orders` (cascade), `product_id → products` (set null) |
| `order_status_history`, `order_notes` | timeline and internal notes | `order_id → orders` (cascade) |
| `reviews` | rating, text, status; unique (order_id, product_id) | → products, orders (cascade) |
| `site_settings` | one row (`key='main'`), nested settings in jsonb | – |
| `inventory_adjustments` | stock history | `product_id → products` (set null) |
| `audit_logs` | admin activity | `admin_id → admins` (set null) |
\* derived automatically by triggers. View: `inventory_view`.

### Why some logic lives in SQL functions
supabase-js has no multi-statement transactions or atomic `$inc`. Anything that must be all-or-nothing is a Postgres function called with `supabase.rpc()`:
`create_order_tx` (order + items + stock reservation + coupon use + customer upsert), `cancel_order_tx`, `set_order_status_tx`, `adjust_stock_tx`, `sync_product_variants`, `reassign_category_tx`, `archive_category_tree`, `category_product_counts`, `dashboard_stats`. Result: **no overselling** (conditional `UPDATE … WHERE stock >= qty` inside one transaction) and no half-created orders.

### Error handling
Database calls go through `utils/dbError.js`, which converts Supabase/PostgREST/Postgres errors (`error.code`, `error.message`) into the API’s `{success:false, code, message}` responses: `23505` → 409 (with friendly codes such as `DUPLICATE_SKU`), `23503` → 409, `23514` → 400, `22P02` → 400, `PGRST116` → 404, errors raised by our functions (`P0001`: `OUT_OF_STOCK`, `INVALID_TRANSITION`, …) → proper 4xx, network failures → 503. Internals are never returned.

## 3. Environment variables
| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | **yes** | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** (prod) | secret server key. `SUPABASE_ANON_KEY` is accepted only as a dev fallback and will not pass RLS |
| `JWT_SECRET` | **yes** | ≥ 32 random chars |
| `FRONTEND_ORIGIN` | **yes** | exact website origin(s), comma-separated; https in production |
| `PORT`, `HOST` | no | Render injects `PORT`; `HOST` defaults to `0.0.0.0` |
| `NODE_ENV`, `TRUST_PROXY`, `COOKIE_SAMESITE` | prod | `production`, `1`, `none` (cross-site) or `lax` (same site) |
| `CLOUDINARY_*` | for uploads | otherwise uploads return 503 |
| `WHATSAPP_BUSINESS_NUMBER`, `SITE_URL`, `*_RATE_LIMIT_MAX`, `JWT_EXPIRES_IN` | no | |
| `ADMIN_NAME/EMAIL/PASSWORD` | one-time | only for `npm run create-admin` |

## 4. Authentication design
HttpOnly + Secure + SameSite cookie `cw_admin` (HS256 JWT, 8 h, invalidated by password change) **plus** a per-session CSRF token sent as `X-CSRF-Token` on every write. bcrypt (cost 12), 5-failure lockout, per-IP login rate limit, identical errors for unknown email / wrong password. Roles `super_admin` / `manager` / `staff` are enforced on the server for each route. No public registration, no default password.

## 5. Endpoints
Machine-readable reference: **`docs/openapi.json`** (OpenAPI 3.0.3, 85 operations; IDs are UUIDs). Envelope: `{success, message, data, meta?}` / `{success:false, message, code, details?}`.

## 6. Tests
```bash
npm run check             # syntax + import/export resolution for every file (no dependencies)
npm run test:unit         # node:test – pure logic, error mapping, row mappers, and the real services run against a FAKE Supabase client (no database needed)
npm run test:integration  # Vitest + Supertest against a DEDICATED test Supabase (see below)
```
Integration tests wipe all tables, so they refuse to run unless `ALLOW_DESTRUCTIVE_TESTS=yes`. Use a **separate** Supabase project or a local one: `npx supabase init && npx supabase start`, run `supabase/schema.sql` in its SQL editor, copy `.env.test.example` → `.env.test` with the printed URL/service key. **Never point `.env.test` at production.**

## 7. Deploy to Render
`render.yaml` in the repository root is a Blueprint (root directory `api`, build `npm install --omit=dev`, start `npm start`, health check `/api/v1/health`).
1. Push the project to GitHub. Render → **New → Blueprint** → pick the repo (or create a **Web Service** manually with the same settings).
2. Fill the prompted env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_ORIGIN` (your exact HTTPS website origin), `CLOUDINARY_*`. `JWT_SECRET` is generated for you.
3. After the first deploy open `https://<service>.onrender.com/api/v1/health`.
4. Create the admin once: Render → service → **Shell** → `ADMIN_NAME=… ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run create-admin` (or run it locally with the production URL/key).
5. Put `https://<service>.onrender.com/api/v1` into `PRODUCTION_API_BASE_URL` in `website/assets/js/config.js` and deploy the website.
Notes: the server binds `0.0.0.0:$PORT`; free instances sleep when idle (first request ≈ 30–60 s); cookies work cross-site with `COOKIE_SAMESITE=none` + HTTPS, but same-site custom domains (e.g. `www.` + `api.`) are more robust.

## 8. Security checklist
- [ ] `service_role` key only in Render env vars; `.env` never committed
- [ ] Schema applied **including** the RLS section (don’t skip the last block of `schema.sql`)
- [ ] `FRONTEND_ORIGIN` = exact HTTPS origin; `JWT_SECRET` random ≥ 32 chars
- [ ] Admin password changed from provisioning value; `ADMIN_PASSWORD` removed
- [ ] Supabase backups/PITR reviewed (Pro plan for point-in-time recovery)
- [ ] `npm run audit` reviewed
