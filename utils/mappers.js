/**
 * Row mappers: PostgreSQL snake_case rows  →  the camelCase JSON the website and Admin Panel already consume.
 * Both `id` and `_id` are emitted (UUID strings) so the website and Admin Panel work unchanged.
 * Embedded relations come from PostgREST selects (see the SELECT_* constants below).
 */
const n = (v) => (v === null || v === undefined ? v : Number(v));
const withId = (o, id) => ({ id, _id: id, ...o });
const ref = (obj, fallbackId) => (obj ? { id: obj.id, _id: obj.id, name: obj.name, slug: obj.slug, level: obj.level } : fallbackId ?? null);

/* ---------- select strings (PostgREST embedding; FK constraint names are defined in schema.sql) ---------- */
export const SELECT_PRODUCT = '*, variants:product_variants(*), category:categories!products_category_id_fkey(id,name,slug,level), subcategory:categories!products_subcategory_id_fkey(id,name,slug,level), child_category:categories!products_child_category_id_fkey(id,name,slug,level)';
export const SELECT_ORDER = '*, items:order_items(*), history:order_status_history(*), notes:order_notes(*)';
export const SELECT_ORDER_LIST = '*, items:order_items(quantity)';
export const SELECT_COUPON = '*, coupon_products(product_id), coupon_categories(category_id)';
export const SELECT_OFFER = '*, offer_products(products(id,name,slug)), offer_categories(categories(id,name,slug))';
export const SELECT_BANNER = '*, product:products(id,name,slug), category:categories(id,name,slug)';

/* ---------- mappers ---------- */
export const mapVariant = (v) => withId({
  label: v.label, sku: v.sku, price: n(v.price), discountPrice: n(v.discount_price), stock: v.stock,
  lowStockThreshold: v.low_stock_threshold, isActive: v.is_active, sortOrder: v.sort_order,
}, v.id);

export function mapProduct(r) {
  const variants = [...(r.variants || [])].sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at))).map(mapVariant);
  return withId({
    name: r.name, slug: r.slug, sku: r.sku, shortDescription: r.short_description, description: r.description,
    specifications: r.specifications || [],
    category: ref(r.category, r.category_id), subcategory: ref(r.subcategory, r.subcategory_id), childCategory: ref(r.child_category, r.child_category_id),
    categoryId: r.category_id, subcategoryId: r.subcategory_id, childCategoryId: r.child_category_id,
    images: r.images || [], price: n(r.price), discountPrice: n(r.discount_price), minPrice: n(r.min_price),
    stock: r.stock, lowStockThreshold: r.low_stock_threshold, trackInventory: r.track_inventory, stockStatus: r.stock_status,
    variants, customFields: r.custom_fields || [],
    isFeatured: r.is_featured, isBestseller: r.is_bestseller, isNewArrival: r.is_new_arrival,
    keywords: r.keywords || [], seoTitle: r.seo_title, seoDescription: r.seo_description, shippingInfo: r.shipping_info,
    isActive: r.is_active, isArchived: r.is_archived, soldCount: r.sold_count, createdAt: r.created_at, updatedAt: r.updated_at,
  }, r.id);
}

export const mapCategory = (r) => withId({
  name: r.name, slug: r.slug, description: r.description, image: r.image || null, parent: r.parent_id, level: r.level,
  displayOrder: r.display_order, isActive: r.is_active, isArchived: r.is_archived, seoTitle: r.seo_title, seoDescription: r.seo_description,
  createdAt: r.created_at, updatedAt: r.updated_at,
}, r.id);

export const mapOrderItem = (i) => ({
  product: i.product_id, name: i.name, sku: i.sku, slug: i.slug, image: i.image, variantId: i.variant_id, variantLabel: i.variant_label,
  customizations: i.customizations || [], quantity: i.quantity, mrp: n(i.mrp), unitPrice: n(i.unit_price), lineTotal: n(i.line_total), tracked: i.tracked,
});

export const mapOrder = (r) => withId({
  orderId: r.order_id, idempotencyKey: r.idempotency_key,
  customer: { name: r.customer_name, phone: r.customer_phone, whatsapp: r.customer_whatsapp, email: r.customer_email },
  address: r.address,
  items: (r.items || []).map(mapOrderItem),
  subtotal: n(r.subtotal), discount: n(r.discount), shippingCharge: n(r.shipping_charge), total: n(r.total), currency: r.currency,
  couponCode: r.coupon_code, status: r.status,
  statusHistory: [...(r.history || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h) => ({ status: h.status, at: h.at, by: h.by_actor, note: h.note })),
  paymentStatus: r.payment_status, amountCollected: n(r.amount_collected),
  customerNotes: r.customer_notes, giftMessage: r.gift_message,
  adminNotes: [...(r.notes || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((x) => ({ note: x.note, by: x.by_actor, at: x.at })),
  stockReleased: r.stock_released, createdAt: r.created_at, updatedAt: r.updated_at,
}, r.id);

export const mapCustomer = (r) => withId({
  phone: r.phone, name: r.name, email: r.email, whatsapp: r.whatsapp, lastAddress: r.last_address, orderCount: r.order_count,
  totalOrderValue: n(r.total_order_value), lastOrderAt: r.last_order_at, createdAt: r.created_at,
}, r.id);

export const mapCoupon = (r) => withId({
  code: r.code, description: r.description, type: r.type, value: n(r.value), minCartAmount: n(r.min_cart_amount), maxDiscount: n(r.max_discount),
  startsAt: r.starts_at, expiresAt: r.expires_at, usageLimit: r.usage_limit, perCustomerLimit: r.per_customer_limit, usedCount: r.used_count,
  products: (r.coupon_products || []).map((x) => x.product_id), categories: (r.coupon_categories || []).map((x) => x.category_id),
  isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
}, r.id);

const nameRef = (o) => (o ? { id: o.id, _id: o.id, name: o.name, slug: o.slug } : null);
export const mapOffer = (r) => withId({
  title: r.title, description: r.description, image: r.image || null, startsAt: r.starts_at, endsAt: r.ends_at, isActive: r.is_active, couponCode: r.coupon_code,
  products: (r.offer_products || []).map((x) => nameRef(x.products)).filter(Boolean),
  categories: (r.offer_categories || []).map((x) => nameRef(x.categories)).filter(Boolean),
  createdAt: r.created_at, updatedAt: r.updated_at,
}, r.id);

export const mapBanner = (r) => withId({
  title: r.title, description: r.description, image: r.image, mobileImage: r.mobile_image || null, ctaLabel: r.cta_label, linkUrl: r.link_url,
  product: nameRef(r.product), category: nameRef(r.category), displayOrder: r.display_order, startsAt: r.starts_at, endsAt: r.ends_at,
  isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
}, r.id);

export const mapReview = (r) => withId({
  product: r.product && typeof r.product === 'object' ? nameRef(r.product) : r.product_id, customerName: r.customer_name, rating: r.rating,
  title: r.title, text: r.text, status: r.status, createdAt: r.created_at,
}, r.id);

export const mapAdjustment = (r) => withId({
  product: r.product_id, productName: r.product_name, sku: r.sku, variantId: r.variant_id, variantLabel: r.variant_label,
  previousStock: r.previous_stock, newStock: r.new_stock, delta: r.delta, reason: r.reason, source: r.source, reference: r.reference,
  adminEmail: r.admin_email, createdAt: r.created_at,
}, r.id);

export const mapAudit = (r) => withId({ action: r.action, entity: r.entity, entityId: r.entity_id, adminEmail: r.admin_email, meta: r.meta, createdAt: r.created_at }, r.id);

/** Admin row → object used by auth code (includes hash). Use toSafeAdmin() for anything returned to a client. */
export const mapAdmin = (r) => ({
  id: r.id, _id: r.id, name: r.name, email: r.email, role: r.role, isActive: r.is_active, passwordHash: r.password_hash,
  failedLoginAttempts: r.failed_login_attempts, lockUntil: r.lock_until ? new Date(r.lock_until) : null,
  lastLoginAt: r.last_login_at, passwordChangedAt: r.password_changed_at ? new Date(r.password_changed_at) : null,
});
export const toSafeAdmin = (a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, lastLoginAt: a.lastLoginAt });
