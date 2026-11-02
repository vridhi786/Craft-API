-- =====================================================================================
-- The Crafters Workshop – Supabase (PostgreSQL 15) schema
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run on an EMPTY project; it is not an upgrade script.
--
-- Design notes
--  * UUID primary keys (gen_random_uuid) replace Mongo ObjectIds.
--  * snake_case columns; the API maps them back to the camelCase JSON the website already uses.
--  * Variants, order items, status history, order notes are real tables (foreign keys, indexes, no unbounded arrays).
--  * Small, always-read-together structures (images, specifications, custom fields, addresses) are JSONB.
--  * Anything that must be atomic (stock reservation, order creation, cancellation, stock adjustment,
--    status change, category re-assignment) is a PL/pgSQL function = one transaction. The API calls them via supabase.rpc().
--  * Row Level Security is ENABLED on every table with NO policies, and all privileges are revoked from anon/authenticated:
--    the public anon key cannot read or write anything. Only the API (service_role key) can.
-- =====================================================================================

create extension if not exists pg_trgm;

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Effective selling price: mirrors utils/pricing.js (variant price overrides product price; discount only if lower).
create or replace function public.effective_price(p_price numeric, p_disc numeric, v_price numeric, v_disc numeric)
returns numeric language sql immutable as $$
  with b as (
    select coalesce(v_price, p_price) as base,
           case when v_price is not null then v_disc when v_disc is not null then v_disc else p_disc end as sale
  )
  select case when sale is not null and sale >= 0 and sale < base then sale else base end from b
$$;

-- Order status machine (mirrors utils/orderStatus.js)
create or replace function public.order_can_transition(p_from text, p_to text) returns boolean language sql immutable as $$
  select case p_from
    when 'pending_confirmation' then p_to in ('confirmed','cancelled')
    when 'confirmed'            then p_to in ('processing','cancelled')
    when 'processing'           then p_to in ('ready_to_ship','cancelled')
    when 'ready_to_ship'        then p_to in ('shipped','cancelled')
    when 'shipped'              then p_to in ('out_for_delivery','delivered')
    when 'out_for_delivery'     then p_to = 'delivered'
    else false end
$$;

-- ============================ ADMINS ============================
create table public.admins (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 80),
  email                 text not null,
  password_hash         text not null,
  role                  text not null default 'manager' check (role in ('super_admin','manager','staff')),
  is_active             boolean not null default true,
  failed_login_attempts int  not null default 0,
  lock_until            timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index admins_email_key on public.admins (lower(email));
create trigger admins_updated_at before update on public.admins for each row execute function public.set_updated_at();

-- ============================ CATEGORIES (3 levels, self-referencing) ============================
create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  slug            text not null,
  description     text not null default '' check (char_length(description) <= 600),
  image           jsonb,                                   -- {url, publicId, alt}
  parent_id       uuid,
  level           smallint not null default 1 check (level between 1 and 3),
  display_order   int not null default 0,
  is_active       boolean not null default true,
  is_archived     boolean not null default false,
  seo_title       text,
  seo_description text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint categories_slug_key unique (slug),
  constraint categories_parent_id_fkey foreign key (parent_id) references public.categories (id) on delete restrict,
  constraint categories_level_parent_chk check ((level = 1 and parent_id is null) or (level > 1 and parent_id is not null))
);
create index categories_parent_idx   on public.categories (parent_id, display_order, name);
create index categories_public_idx   on public.categories (level, is_active, is_archived);
-- sibling names are unique (case-insensitive) among non-archived categories
create unique index categories_sibling_name_key on public.categories
  (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where not is_archived;
create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();

create or replace function public.categories_check_parent() returns trigger language plpgsql as $$
declare parent_level smallint;
begin
  if new.parent_id is not null then
    select level into parent_level from public.categories where id = new.parent_id;
    if parent_level is null or parent_level <> new.level - 1 then
      raise exception 'INVALID_PARENT_LEVEL' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger categories_parent_chk before insert or update of parent_id, level on public.categories
  for each row execute function public.categories_check_parent();

-- ============================ PRODUCTS ============================
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 140),
  slug              text not null,
  sku               text not null,
  short_description text not null default '' check (char_length(short_description) <= 300),
  description       text not null default '' check (char_length(description) <= 6000),
  specifications    jsonb not null default '[]'::jsonb,       -- [{label,value}]
  category_id       uuid not null,
  subcategory_id    uuid,
  child_category_id uuid,
  images            jsonb not null default '[]'::jsonb,       -- [{url,publicId,alt}] (max 10, enforced by API + check)
  price             numeric(12,2) not null check (price >= 0),
  discount_price    numeric(12,2) check (discount_price is null or (discount_price >= 0 and discount_price < price)),
  min_price         numeric(12,2) not null default 0,         -- derived by trigger
  stock             int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 3 check (low_stock_threshold >= 0),
  track_inventory   boolean not null default true,
  stock_status      text not null default 'in_stock' check (stock_status in ('in_stock','low_stock','out_of_stock')), -- derived
  custom_fields     jsonb not null default '[]'::jsonb,       -- [{key,label,type,required,options,maxLength,helpText}]
  is_featured       boolean not null default false,
  is_bestseller     boolean not null default false,
  is_new_arrival    boolean not null default false,
  keywords          text[] not null default '{}',
  search_text       text not null default '',                 -- derived, trigram-indexed
  seo_title         text,
  seo_description   text,
  shipping_info     text not null default '',
  is_active         boolean not null default true,
  is_archived       boolean not null default false,
  sold_count        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint products_slug_key unique (slug),
  constraint products_sku_key  unique (sku),
  constraint products_category_id_fkey       foreign key (category_id)       references public.categories (id) on delete restrict,
  constraint products_subcategory_id_fkey    foreign key (subcategory_id)    references public.categories (id) on delete restrict,
  constraint products_child_category_id_fkey foreign key (child_category_id) references public.categories (id) on delete restrict,
  constraint products_child_needs_sub_chk check (child_category_id is null or subcategory_id is not null),
  constraint products_images_max_chk check (jsonb_array_length(images) <= 10)
);
create index products_listing_idx     on public.products (is_active, is_archived, created_at desc);
create index products_category_idx     on public.products (category_id)       where not is_archived;
create index products_subcategory_idx on public.products (subcategory_id)    where subcategory_id is not null;
create index products_child_idx       on public.products (child_category_id) where child_category_id is not null;
create index products_min_price_idx   on public.products (min_price);
create index products_popular_idx     on public.products (sold_count desc, created_at desc);
create index products_name_idx        on public.products (name);
create index products_stock_status_idx on public.products (stock_status) where track_inventory;
create index products_featured_idx    on public.products (created_at desc) where is_featured and is_active and not is_archived;
create index products_bestseller_idx  on public.products (created_at desc) where is_bestseller and is_active and not is_archived;
create index products_new_idx         on public.products (created_at desc) where is_new_arrival and is_active and not is_archived;
create index products_search_trgm_idx on public.products using gin (search_text gin_trgm_ops);
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

create table public.product_variants (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products (id) on delete cascade,
  label               text not null check (char_length(label) between 1 and 80),
  sku                 text,
  price               numeric(12,2) check (price is null or price >= 0),
  discount_price      numeric(12,2) check (discount_price is null or discount_price >= 0),
  stock               int not null default 0 check (stock >= 0),
  low_stock_threshold int check (low_stock_threshold is null or low_stock_threshold >= 0),
  is_active           boolean not null default true,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint variants_discount_chk check (price is null or discount_price is null or discount_price < price)
);
create unique index product_variants_label_key on public.product_variants (product_id, lower(label));
create index product_variants_product_idx on public.product_variants (product_id, sort_order);
create trigger product_variants_updated_at before update on public.product_variants for each row execute function public.set_updated_at();

-- Derived columns on products: min_price, stock_status, search_text (mirror utils/pricing.js)
create or replace function public.products_derive() returns trigger language plpgsql as $$
declare vcount int; vstock bigint; vmin numeric;
begin
  select count(*) filter (where v.is_active),
         coalesce(sum(v.stock) filter (where v.is_active), 0),
         min(public.effective_price(new.price, new.discount_price, v.price, v.discount_price)) filter (where v.is_active)
    into vcount, vstock, vmin
    from public.product_variants v where v.product_id = new.id;

  if vcount > 0 then
    new.stock := 0;
    new.min_price := vmin;
    new.stock_status := case when not new.track_inventory then 'in_stock'
                             when vstock <= 0 then 'out_of_stock'
                             when vstock <= new.low_stock_threshold then 'low_stock' else 'in_stock' end;
  else
    new.min_price := public.effective_price(new.price, new.discount_price, null, null);
    new.stock_status := case when not new.track_inventory then 'in_stock'
                             when new.stock <= 0 then 'out_of_stock'
                             when new.stock <= new.low_stock_threshold then 'low_stock' else 'in_stock' end;
  end if;
  new.search_text := lower(new.name || ' ' || new.sku || ' ' || coalesce(new.short_description, '') || ' ' || array_to_string(new.keywords, ' '));
  return new;
end $$;
create trigger a_products_derive before insert or update on public.products for each row execute function public.products_derive();

-- Any variant change re-derives its product (touching the row fires products_derive).
create or replace function public.variants_touch_product() returns trigger language plpgsql as $$
begin
  update public.products set updated_at = now() where id = coalesce(new.product_id, old.product_id);
  return null;
end $$;
create trigger variants_touch_product after insert or update or delete on public.product_variants
  for each row execute function public.variants_touch_product();

-- ============================ CUSTOMERS ============================
create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  phone             text not null,
  name              text not null,
  email             text,
  whatsapp          text,
  last_address      jsonb,
  order_count       int not null default 0,
  total_order_value numeric(14,2) not null default 0,
  last_order_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint customers_phone_key unique (phone)
);
create index customers_name_idx  on public.customers (lower(name));
create index customers_last_order_idx on public.customers (last_order_at desc nulls last);
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();

-- ============================ COUPONS / OFFERS / BANNERS ============================
create table public.coupons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  description        text not null default '',
  type               text not null check (type in ('percentage','fixed')),
  value              numeric(12,2) not null check (value > 0),
  min_cart_amount    numeric(12,2) not null default 0 check (min_cart_amount >= 0),
  max_discount       numeric(12,2) check (max_discount is null or max_discount >= 0),
  starts_at          timestamptz,
  expires_at         timestamptz,
  usage_limit        int check (usage_limit is null or usage_limit >= 1),
  per_customer_limit int check (per_customer_limit is null or per_customer_limit >= 1),
  used_count         int not null default 0 check (used_count >= 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint coupons_code_key unique (code),
  constraint coupons_percent_chk check (type <> 'percentage' or value <= 100),
  constraint coupons_dates_chk check (starts_at is null or expires_at is null or expires_at > starts_at)
);
create trigger coupons_updated_at before update on public.coupons for each row execute function public.set_updated_at();

create table public.coupon_products (
  coupon_id  uuid not null references public.coupons (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (coupon_id, product_id)
);
create index coupon_products_product_idx on public.coupon_products (product_id);
create table public.coupon_categories (
  coupon_id   uuid not null references public.coupons (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (coupon_id, category_id)
);
create index coupon_categories_category_idx on public.coupon_categories (category_id);

create table public.offers (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  image       jsonb,
  starts_at   timestamptz,
  ends_at     timestamptz,
  is_active   boolean not null default true,
  coupon_code text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index offers_active_idx on public.offers (is_active, starts_at, ends_at);
create trigger offers_updated_at before update on public.offers for each row execute function public.set_updated_at();
create table public.offer_products (
  offer_id   uuid not null references public.offers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (offer_id, product_id)
);
create index offer_products_product_idx on public.offer_products (product_id);
create table public.offer_categories (
  offer_id    uuid not null references public.offers (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (offer_id, category_id)
);
create index offer_categories_category_idx on public.offer_categories (category_id);

create table public.banners (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 120),
  description   text not null default '',
  image         jsonb not null,
  mobile_image  jsonb,
  cta_label     text not null default 'Shop now',
  link_url      text,
  product_id    uuid references public.products (id) on delete set null,
  category_id   uuid references public.categories (id) on delete set null,
  display_order int not null default 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index banners_active_idx on public.banners (is_active, display_order);
create trigger banners_updated_at before update on public.banners for each row execute function public.set_updated_at();

-- ============================ ORDERS ============================
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_id         text not null,                              -- public reference e.g. CW-261031-AB12CD
  idempotency_key  text,
  customer_name    text not null,
  customer_phone   text not null,
  customer_whatsapp text,
  customer_email   text,
  address          jsonb not null,                             -- {line1,line2,city,state,pincode,landmark} snapshot
  subtotal         numeric(12,2) not null check (subtotal >= 0),
  discount         numeric(12,2) not null default 0 check (discount >= 0),
  shipping_charge  numeric(12,2) not null default 0 check (shipping_charge >= 0),
  total            numeric(12,2) not null check (total >= 0),
  currency         text not null default 'INR',
  coupon_code      text,
  status           text not null default 'pending_confirmation'
                   check (status in ('pending_confirmation','confirmed','processing','ready_to_ship','shipped','out_for_delivery','delivered','cancelled')),
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  amount_collected numeric(12,2) not null default 0 check (amount_collected >= 0),
  customer_notes   text,
  gift_message     text,
  stock_released   boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint orders_order_id_key unique (order_id),
  constraint orders_idempotency_key_key unique (idempotency_key)  -- NULLs are allowed and never conflict
);
create index orders_status_created_idx on public.orders (status, created_at desc);
create index orders_created_idx        on public.orders (created_at desc);
create index orders_phone_idx          on public.orders (customer_phone, created_at desc);
create index orders_name_trgm_idx      on public.orders using gin (lower(customer_name) gin_trgm_ops);
create index orders_payment_idx        on public.orders (payment_status);
create index orders_coupon_idx         on public.orders (coupon_code, customer_phone) where coupon_code is not null;
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  product_id      uuid references public.products (id) on delete set null,   -- snapshot survives product deletion
  variant_id      uuid,                                                       -- snapshot only (no FK: variants can be edited/removed)
  name            text not null,
  sku             text,
  slug            text,
  image           text,
  variant_label   text,
  customizations  jsonb not null default '[]'::jsonb,                        -- [{key,label,value}]
  quantity        int not null check (quantity between 1 and 50),
  mrp             numeric(12,2) not null,
  unit_price      numeric(12,2) not null,
  line_total      numeric(12,2) not null,
  tracked         boolean not null default true
);
create index order_items_order_idx   on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

create table public.order_status_history (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status   text not null,
  at       timestamptz not null default now(),
  by_actor text,
  note     text
);
create index order_status_history_order_idx on public.order_status_history (order_id, at);

create table public.order_notes (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  note     text not null,
  by_actor text,
  at       timestamptz not null default now()
);
create index order_notes_order_idx on public.order_notes (order_id, at);

-- ============================ REVIEWS ============================
create table public.reviews (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete cascade,
  order_id       uuid not null references public.orders (id) on delete cascade,   -- verified purchase
  customer_name  text not null check (char_length(customer_name) <= 60),
  customer_phone text not null,
  rating         smallint not null check (rating between 1 and 5),
  title          text not null default '',
  text           text not null check (char_length(text) between 1 and 1500),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint reviews_one_per_order_product unique (order_id, product_id)
);
create index reviews_product_status_idx on public.reviews (product_id, status, created_at desc);
create index reviews_status_idx         on public.reviews (status, created_at desc);
create trigger reviews_updated_at before update on public.reviews for each row execute function public.set_updated_at();

-- ============================ SETTINGS / INVENTORY HISTORY / AUDIT ============================
create table public.site_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null default 'main',
  data       jsonb not null default '{}'::jsonb,       -- nested settings; defaults are merged in by the API
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_settings_key_key unique (key)
);
create trigger site_settings_updated_at before update on public.site_settings for each row execute function public.set_updated_at();

create table public.inventory_adjustments (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid references public.products (id) on delete set null,
  product_name   text,
  sku            text,
  variant_id     uuid,
  variant_label  text,
  previous_stock int not null,
  new_stock      int not null,
  delta          int not null,
  reason         text not null check (char_length(reason) <= 200),
  source         text not null default 'manual' check (source in ('manual','order','order_cancelled')),
  reference      text,
  admin_email    text,
  created_at     timestamptz not null default now()
);
create index inventory_adjustments_product_idx on public.inventory_adjustments (product_id, created_at desc);
create index inventory_adjustments_created_idx on public.inventory_adjustments (created_at desc);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.admins (id) on delete set null,
  admin_email text,
  action      text not null,
  entity      text,
  entity_id   text,
  meta        jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ============================ VIEWS ============================
-- One row per tracked product (no variants) or per active variant. security_invoker keeps RLS in force.
create or replace view public.inventory_view with (security_invoker = true) as
  select p.id as product_id, null::uuid as variant_id, p.name, null::text as variant, p.sku,
         p.stock, p.low_stock_threshold as threshold, p.stock_status as status, p.is_active
    from public.products p
   where not p.is_archived and p.track_inventory
     and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active)
  union all
  select p.id, v.id, p.name, v.label, coalesce(v.sku, p.sku), v.stock,
         coalesce(v.low_stock_threshold, p.low_stock_threshold),
         case when v.stock <= 0 then 'out_of_stock'
              when v.stock <= coalesce(v.low_stock_threshold, p.low_stock_threshold) then 'low_stock' else 'in_stock' end,
         p.is_active
    from public.products p join public.product_variants v on v.product_id = p.id
   where not p.is_archived and p.track_inventory and v.is_active;

-- ============================ TRANSACTIONAL FUNCTIONS (called with supabase.rpc) ============================
-- Errors are raised as: errcode P0001, message = a stable CODE, detail = human detail. The API maps them to HTTP responses.

-- Create an order atomically: coupon use, order row, items, stock reservation, history, customer upsert.
-- If anything fails (out of stock, exhausted coupon, duplicate idempotency key) NOTHING is written.
create or replace function public.create_order_tx(p_order jsonb, p_items jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid; it jsonb; v_coupon uuid := nullif(p_order->>'coupon_id', '')::uuid;
  v_pid uuid; v_vid uuid; v_qty int; v_new int; v_vlabel text; v_tracked boolean;
begin
  if v_coupon is not null then
    update public.coupons set used_count = used_count + 1
     where id = v_coupon and (usage_limit is null or used_count < usage_limit);
    if not found then raise exception 'COUPON_EXHAUSTED' using errcode = 'P0001'; end if;
  end if;

  insert into public.orders (order_id, idempotency_key, customer_name, customer_phone, customer_whatsapp, customer_email, address,
                             subtotal, discount, shipping_charge, total, coupon_code, customer_notes, gift_message)
  values (p_order->>'order_id', nullif(p_order->>'idempotency_key', ''), p_order->>'customer_name', p_order->>'customer_phone',
          nullif(p_order->>'customer_whatsapp', ''), nullif(p_order->>'customer_email', ''), p_order->'address',
          (p_order->>'subtotal')::numeric, (p_order->>'discount')::numeric, (p_order->>'shipping_charge')::numeric, (p_order->>'total')::numeric,
          nullif(p_order->>'coupon_code', ''), nullif(p_order->>'customer_notes', ''), nullif(p_order->>'gift_message', ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_vid := nullif(it->>'variant_id', '')::uuid;
    v_qty := (it->>'quantity')::int;
    v_tracked := coalesce((it->>'tracked')::boolean, true);
    v_vlabel := it->>'variant_label';

    insert into public.order_items (order_id, product_id, variant_id, name, sku, slug, image, variant_label, customizations, quantity, mrp, unit_price, line_total, tracked)
    values (v_id, v_pid, v_vid, it->>'name', it->>'sku', it->>'slug', it->>'image', v_vlabel, coalesce(it->'customizations', '[]'::jsonb),
            v_qty, (it->>'mrp')::numeric, (it->>'unit_price')::numeric, (it->>'line_total')::numeric, v_tracked);

    if v_tracked then
      if v_vid is not null then
        update public.product_variants set stock = stock - v_qty where id = v_vid and product_id = v_pid and stock >= v_qty returning stock into v_new;
      else
        update public.products set stock = stock - v_qty where id = v_pid and stock >= v_qty returning stock into v_new;
      end if;
      if not found then raise exception 'OUT_OF_STOCK' using errcode = 'P0001', detail = it->>'name'; end if;
      insert into public.inventory_adjustments (product_id, product_name, sku, variant_id, variant_label, previous_stock, new_stock, delta, reason, source, reference)
      values (v_pid, it->>'name', it->>'sku', v_vid, v_vlabel, v_new + v_qty, v_new, -v_qty, 'Order placed', 'order', p_order->>'order_id');
    end if;
  end loop;

  insert into public.order_status_history (order_id, status, by_actor, note) values (v_id, 'pending_confirmation', 'customer', 'Order placed on website');

  insert into public.customers (phone, name, email, whatsapp, last_address, order_count, total_order_value, last_order_at)
  values (p_order->>'customer_phone', p_order->>'customer_name', nullif(p_order->>'customer_email', ''), nullif(p_order->>'customer_whatsapp', ''),
          p_order->'address', 1, (p_order->>'total')::numeric, now())
  on conflict (phone) do update set name = excluded.name, email = excluded.email, whatsapp = excluded.whatsapp, last_address = excluded.last_address,
      order_count = customers.order_count + 1, total_order_value = customers.total_order_value + excluded.total_order_value, last_order_at = now();

  return v_id;
end $$;

-- Cancel: validates the transition, restores stock once, releases the coupon use, updates customer totals.
create or replace function public.cancel_order_tx(p_id uuid, p_reason text, p_by text) returns void
language plpgsql as $$
declare o public.orders; it public.order_items; v_new int;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.order_can_transition(o.status, 'cancelled') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = o.status;
  end if;
  update public.orders set status = 'cancelled' where id = o.id;
  insert into public.order_status_history (order_id, status, by_actor, note) values (o.id, 'cancelled', p_by, p_reason);

  if not o.stock_released then
    for it in select * from public.order_items where order_id = o.id and tracked and product_id is not null loop
      if it.variant_id is not null then
        update public.product_variants set stock = stock + it.quantity where id = it.variant_id and product_id = it.product_id returning stock into v_new;
      else
        update public.products set stock = stock + it.quantity where id = it.product_id returning stock into v_new;
      end if;
      if found then
        insert into public.inventory_adjustments (product_id, product_name, sku, variant_id, variant_label, previous_stock, new_stock, delta, reason, source, reference)
        values (it.product_id, it.name, it.sku, it.variant_id, it.variant_label, v_new - it.quantity, v_new, it.quantity, 'Order cancelled', 'order_cancelled', o.order_id);
      end if;
    end loop;
    if o.coupon_code is not null then
      update public.coupons set used_count = greatest(used_count - 1, 0) where code = o.coupon_code;
    end if;
    update public.customers set order_count = greatest(order_count - 1, 0), total_order_value = greatest(total_order_value - o.total, 0) where phone = o.customer_phone;
    update public.orders set stock_released = true where id = o.id;
  end if;
end $$;

-- Move an order forward (not used for cancellation).
create or replace function public.set_order_status_tx(p_id uuid, p_status text, p_note text, p_by text) returns void
language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.order_can_transition(o.status, p_status) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = o.status;
  end if;
  update public.orders set status = p_status where id = o.id;
  insert into public.order_status_history (order_id, status, by_actor, note) values (o.id, p_status, p_by, p_note);
  if p_status = 'delivered' then
    update public.products p set sold_count = sold_count + i.q
      from (select product_id, sum(quantity)::int as q from public.order_items where order_id = o.id and product_id is not null group by product_id) i
     where p.id = i.product_id;
  end if;
end $$;

-- Manual stock change (relative p_delta OR absolute p_set) with history. Returns {previous, new}.
create or replace function public.adjust_stock_tx(p_product uuid, p_variant uuid, p_delta int, p_set int, p_reason text, p_admin text) returns jsonb
language plpgsql as $$
declare pr public.products; v public.product_variants; v_prev int; v_next int;
begin
  select * into pr from public.products where id = p_product for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if (p_delta is null) = (p_set is null) then raise exception 'DELTA_OR_SET' using errcode = 'P0001'; end if;

  if p_variant is null then
    if exists (select 1 from public.product_variants where product_id = p_product and is_active) then
      raise exception 'VARIANT_REQUIRED' using errcode = 'P0001';
    end if;
    v_prev := pr.stock;
  else
    select * into v from public.product_variants where id = p_variant and product_id = p_product for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
    v_prev := v.stock;
  end if;

  v_next := coalesce(p_set, v_prev + p_delta);
  if v_next < 0 then raise exception 'NEGATIVE_STOCK' using errcode = 'P0001'; end if;
  if p_variant is null then update public.products set stock = v_next where id = p_product;
  else update public.product_variants set stock = v_next where id = p_variant; end if;

  insert into public.inventory_adjustments (product_id, product_name, sku, variant_id, variant_label, previous_stock, new_stock, delta, reason, source, admin_email)
  values (p_product, pr.name, coalesce(v.sku, pr.sku), p_variant, v.label, v_prev, v_next, v_next - v_prev, p_reason, 'manual', p_admin);
  return jsonb_build_object('previous', v_prev, 'new', v_next);
end $$;

-- Replace a product's variants in one transaction. Each element: {id?, label, sku, price, discount_price, stock, low_stock_threshold, is_active}.
-- Existing variants (with id) keep their current stock; only new variants take the supplied stock.
create or replace function public.sync_product_variants(p_product uuid, p_variants jsonb) returns void
language plpgsql as $$
declare e jsonb; i int := 0; v_id uuid;
begin
  delete from public.product_variants
   where product_id = p_product
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(p_variants) x where x->>'id' is not null);
  for e in select * from jsonb_array_elements(p_variants) loop
    i := i + 1;
    v_id := nullif(e->>'id', '')::uuid;
    if v_id is not null then
      update public.product_variants set label = e->>'label', sku = nullif(e->>'sku', ''),
             price = nullif(e->>'price', '')::numeric, discount_price = nullif(e->>'discount_price', '')::numeric,
             low_stock_threshold = nullif(e->>'low_stock_threshold', '')::int, is_active = coalesce((e->>'is_active')::boolean, true), sort_order = i
       where id = v_id and product_id = p_product;
      if not found then raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'variant'; end if;
    else
      insert into public.product_variants (product_id, label, sku, price, discount_price, stock, low_stock_threshold, is_active, sort_order)
      values (p_product, e->>'label', nullif(e->>'sku', ''), nullif(e->>'price', '')::numeric, nullif(e->>'discount_price', '')::numeric,
              coalesce((e->>'stock')::int, 0), nullif(e->>'low_stock_threshold', '')::int, coalesce((e->>'is_active')::boolean, true), i);
    end if;
  end loop;
  update public.products set updated_at = now() where id = p_product;  -- re-derive min_price / stock_status
end $$;

-- Products per category node (a product counts toward its category, subcategory and child category).
create or replace function public.category_product_counts(p_public boolean) returns table (category_id uuid, n bigint)
language sql stable as $$
  select cid, count(*) from (
    select category_id as cid from public.products where not is_archived and (not p_public or is_active)
    union all select subcategory_id    from public.products where subcategory_id is not null    and not is_archived and (not p_public or is_active)
    union all select child_category_id from public.products where child_category_id is not null and not is_archived and (not p_public or is_active)
  ) t group by cid
$$;

-- Archive a category and all of its descendants. Returns how many were archived.
create or replace function public.archive_category_tree(p_id uuid) returns int language plpgsql as $$
declare n int;
begin
  with recursive tree as (
    select id from public.categories where id = p_id
    union all select c.id from public.categories c join tree t on c.parent_id = t.id
  )
  update public.categories set is_archived = true, is_active = false where id in (select id from tree);
  get diagnostics n = row_count;
  return n;
end $$;

-- Move sub-items and products from one category to another at the same level, then delete the source.
create or replace function public.reassign_category_tx(p_from uuid, p_to uuid) returns jsonb language plpgsql as $$
declare f public.categories; t public.categories; v_sub uuid; v_cat uuid; kids int; prods int;
begin
  select * into f from public.categories where id = p_from for update;
  select * into t from public.categories where id = p_to;
  if f.id is null or t.id is null or f.id = t.id or t.is_archived or f.level <> t.level then
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;
  if exists (with recursive d as (select id from public.categories where parent_id = p_from
                                  union all select c.id from public.categories c join d on c.parent_id = d.id)
             select 1 from d where id = p_to) then
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;
  select count(*) into kids from public.categories where parent_id = p_from;
  update public.categories set parent_id = p_to where parent_id = p_from;
  if f.level = 1 then
    update public.products set category_id = p_to where category_id = p_from;
  elsif f.level = 2 then
    update public.products set subcategory_id = p_to, category_id = t.parent_id where subcategory_id = p_from;
  else
    v_sub := t.parent_id;
    select parent_id into v_cat from public.categories where id = v_sub;
    update public.products set child_category_id = p_to, subcategory_id = v_sub, category_id = v_cat where child_category_id = p_from;
  end if;
  get diagnostics prods = row_count;
  delete from public.categories where id = p_from;
  return jsonb_build_object('children', kids, 'products', prods);
end $$;

-- Dashboard numbers in one round trip. Gross order value = non-cancelled orders in the period (NOT money received).
create or replace function public.dashboard_stats(p_from timestamptz, p_to timestamptz) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'byStatus', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.orders group by status) s), '{}'::jsonb),
    'period', (select jsonb_build_object('orders', count(*), 'gross', coalesce(sum(total), 0), 'collected', coalesce(sum(amount_collected), 0))
                 from public.orders where status <> 'cancelled' and created_at between p_from and p_to),
    'products', jsonb_build_object(
        'total',  (select count(*) from public.products where not is_archived),
        'active', (select count(*) from public.products where not is_archived and is_active),
        'low',    (select count(*) from public.inventory_view where status = 'low_stock'),
        'out',    (select count(*) from public.inventory_view where status = 'out_of_stock')),
    'customers', (select count(*) from public.customers)
  )
$$;

-- ============================ SECURITY ============================
alter table public.admins                enable row level security;
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.product_variants      enable row level security;
alter table public.customers             enable row level security;
alter table public.coupons               enable row level security;
alter table public.coupon_products       enable row level security;
alter table public.coupon_categories     enable row level security;
alter table public.offers                enable row level security;
alter table public.offer_products        enable row level security;
alter table public.offer_categories      enable row level security;
alter table public.banners               enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_status_history  enable row level security;
alter table public.order_notes           enable row level security;
alter table public.reviews               enable row level security;
alter table public.site_settings         enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.audit_logs            enable row level security;
-- No policies are created on purpose: anon / authenticated roles get no access at all.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
