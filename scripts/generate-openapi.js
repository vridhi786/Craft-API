/** Builds docs/openapi.json from the endpoint table below. Keep the table in sync with routes/ (see README). */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// [method, path, auth, tag, summary, requestSchema|null]   auth: public | staff | manager | session
const E = [
  ['get', '/health', 'public', 'System', 'Service health and API version'],
  ['post', '/auth/admin/login', 'public', 'Auth', 'Admin sign-in (sets HttpOnly cookie, returns CSRF token)', 'Login'],
  ['post', '/auth/admin/logout', 'public', 'Auth', 'Clear admin session cookie'],
  ['get', '/auth/admin/me', 'session', 'Auth', 'Current admin and CSRF token'],
  ['post', '/auth/admin/change-password', 'session', 'Auth', 'Change own password', 'ChangePassword'],
  ['get', '/products', 'public', 'Products', 'List active products (page, limit, sort, category, q, minPrice, maxPrice, inStock, ids)'],
  ['get', '/products/featured', 'public', 'Products', 'Featured products'],
  ['get', '/products/bestsellers', 'public', 'Products', 'Bestselling products'],
  ['get', '/products/new-arrivals', 'public', 'Products', 'New arrivals'],
  ['get', '/products/search', 'public', 'Products', 'Search products (q ≥ 2 chars)'],
  ['get', '/products/slug/{slug}', 'public', 'Products', 'Product by slug'],
  ['get', '/products/{id}/related', 'public', 'Products', 'Related products'],
  ['get', '/products/{id}', 'public', 'Products', 'Product by id'],
  ['get', '/categories', 'public', 'Categories', 'Nested tree of active categories'],
  ['get', '/categories/{slug}/products', 'public', 'Categories', 'Products in a category (includes sub-levels)'],
  ['get', '/categories/{id}', 'public', 'Categories', 'Category by id or slug, with children and breadcrumb'],
  ['post', '/cart/validate', 'public', 'Pricing', 'Validate cart lines, stock and customisation', 'Quote'],
  ['post', '/pricing/quote', 'public', 'Pricing', 'Server-calculated price breakdown', 'Quote'],
  ['post', '/orders', 'public', 'Orders', 'Create order (header Idempotency-Key recommended)', 'CreateOrder'],
  ['get', '/orders/{orderId}/track', 'public', 'Orders', 'Track an order (query: phone required)'],
  ['post', '/coupons/validate', 'public', 'Coupons', 'Validate a coupon against a cart', 'CouponValidate'],
  ['get', '/offers', 'public', 'Offers', 'Currently running offers'],
  ['get', '/banners', 'public', 'Banners', 'Currently scheduled banners'],
  ['get', '/reviews', 'public', 'Reviews', 'Approved reviews (optional product filter)'],
  ['post', '/reviews', 'public', 'Reviews', 'Submit a review for a delivered order (pending moderation)', 'Review'],
  ['get', '/settings/public', 'public', 'Settings', 'Public site settings'],
  ['get', '/admin/dashboard', 'staff', 'Admin', 'Dashboard statistics'],
  ['get', '/admin/products', 'manager', 'Admin Products', 'List all products with filters'],
  ['post', '/admin/products', 'manager', 'Admin Products', 'Create product', 'Product'],
  ['get', '/admin/products/{id}', 'manager', 'Admin Products', 'Get product'],
  ['patch', '/admin/products/{id}', 'manager', 'Admin Products', 'Update product', 'Product'],
  ['delete', '/admin/products/{id}', 'manager', 'Admin Products', 'Archive product (?permanent=true: super admin, unordered only)'],
  ['patch', '/admin/products/{id}/status', 'manager', 'Admin Products', 'Activate / deactivate', 'ProductStatus'],
  ['patch', '/admin/products/{id}/stock', 'manager', 'Admin Products', 'Adjust stock with reason', 'StockAdjust'],
  ['get', '/admin/categories', 'manager', 'Admin Categories', 'List categories (all levels)'],
  ['post', '/admin/categories', 'manager', 'Admin Categories', 'Create category (optionally with parent)', 'Category'],
  ['get', '/admin/categories/{id}', 'manager', 'Admin Categories', 'Get category'],
  ['patch', '/admin/categories/{id}', 'manager', 'Admin Categories', 'Update category', 'Category'],
  ['delete', '/admin/categories/{id}', 'manager', 'Admin Categories', 'Delete; 409 if dependents unless archive=true or reassignTo=id'],
  ['get', '/admin/subcategories', 'manager', 'Admin Categories', 'List subcategories (level 2)'],
  ['post', '/admin/subcategories', 'manager', 'Admin Categories', 'Create subcategory (parent = category)', 'Category'],
  ['get', '/admin/subcategories/{id}', 'manager', 'Admin Categories', 'Get subcategory'],
  ['patch', '/admin/subcategories/{id}', 'manager', 'Admin Categories', 'Update subcategory', 'Category'],
  ['delete', '/admin/subcategories/{id}', 'manager', 'Admin Categories', 'Delete subcategory (same safeguards)'],
  ['get', '/admin/child-categories', 'manager', 'Admin Categories', 'List child categories (level 3)'],
  ['post', '/admin/child-categories', 'manager', 'Admin Categories', 'Create child category (parent = subcategory)', 'Category'],
  ['get', '/admin/child-categories/{id}', 'manager', 'Admin Categories', 'Get child category'],
  ['patch', '/admin/child-categories/{id}', 'manager', 'Admin Categories', 'Update child category', 'Category'],
  ['delete', '/admin/child-categories/{id}', 'manager', 'Admin Categories', 'Delete child category (same safeguards)'],
  ['get', '/admin/orders', 'staff', 'Admin Orders', 'List orders (q, status, paymentStatus, from, to, page, limit)'],
  ['post', '/admin/orders/export', 'staff', 'Admin Orders', 'Export filtered orders as CSV', 'OrderFilters'],
  ['get', '/admin/orders/{id}', 'staff', 'Admin Orders', 'Order details (by UUID or order ID)'],
  ['patch', '/admin/orders/{id}/status', 'staff', 'Admin Orders', 'Change status (validated transitions)', 'OrderStatus'],
  ['patch', '/admin/orders/{id}/notes', 'staff', 'Admin Orders', 'Add internal note', 'OrderNote'],
  ['patch', '/admin/orders/{id}/payment', 'staff', 'Admin Orders', 'Record payment collected', 'OrderPayment'],
  ['post', '/admin/orders/{id}/cancel', 'staff', 'Admin Orders', 'Cancel order and restore stock', 'OrderCancel'],
  ['get', '/admin/customers', 'staff', 'Admin Customers', 'List / search customers'],
  ['get', '/admin/customers/{id}', 'staff', 'Admin Customers', 'Customer with order history'],
  ['get', '/admin/coupons', 'manager', 'Admin Coupons', 'List coupons'],
  ['post', '/admin/coupons', 'manager', 'Admin Coupons', 'Create coupon', 'Coupon'],
  ['get', '/admin/coupons/{id}', 'manager', 'Admin Coupons', 'Get coupon'],
  ['patch', '/admin/coupons/{id}', 'manager', 'Admin Coupons', 'Update coupon', 'Coupon'],
  ['delete', '/admin/coupons/{id}', 'manager', 'Admin Coupons', 'Delete coupon'],
  ['get', '/admin/offers', 'manager', 'Admin Offers', 'List offers'],
  ['post', '/admin/offers', 'manager', 'Admin Offers', 'Create offer', 'Offer'],
  ['get', '/admin/offers/{id}', 'manager', 'Admin Offers', 'Get offer'],
  ['patch', '/admin/offers/{id}', 'manager', 'Admin Offers', 'Update offer', 'Offer'],
  ['delete', '/admin/offers/{id}', 'manager', 'Admin Offers', 'Delete offer'],
  ['get', '/admin/banners', 'manager', 'Admin Banners', 'List banners'],
  ['post', '/admin/banners', 'manager', 'Admin Banners', 'Create banner', 'Banner'],
  ['get', '/admin/banners/{id}', 'manager', 'Admin Banners', 'Get banner'],
  ['patch', '/admin/banners/{id}', 'manager', 'Admin Banners', 'Update banner', 'Banner'],
  ['delete', '/admin/banners/{id}', 'manager', 'Admin Banners', 'Delete banner'],
  ['get', '/admin/reviews', 'manager', 'Admin Reviews', 'List reviews (status filter)'],
  ['patch', '/admin/reviews/{id}', 'manager', 'Admin Reviews', 'Approve / reject', 'ReviewModerate'],
  ['delete', '/admin/reviews/{id}', 'manager', 'Admin Reviews', 'Delete review'],
  ['get', '/admin/inventory', 'staff', 'Admin Inventory', 'Stock rows (level=low|out)'],
  ['get', '/admin/inventory/history', 'staff', 'Admin Inventory', 'Stock adjustment history'],
  ['post', '/admin/inventory/adjust', 'staff', 'Admin Inventory', 'Adjust stock', 'InventoryAdjust'],
  ['get', '/admin/settings', 'manager', 'Admin Settings', 'All settings'],
  ['patch', '/admin/settings', 'manager', 'Admin Settings', 'Update settings (partial)', 'Settings'],
  ['post', '/admin/uploads/product-images', 'manager', 'Uploads', 'Upload up to 10 product images (multipart field "images")'],
  ['post', '/admin/uploads/category-images', 'manager', 'Uploads', 'Upload a category image'],
  ['post', '/admin/uploads/banner-images', 'manager', 'Uploads', 'Upload banner images'],
  ['post', '/admin/uploads/site-images', 'manager', 'Uploads', 'Upload logo / favicon / hero image'],
];

const roles = { public: 'None', session: 'Admin session cookie', staff: 'Admin session (staff, manager or super_admin) + X-CSRF-Token on writes', manager: 'Admin session (manager or super_admin) + X-CSRF-Token on writes' };
const schemas = {
  Login: { email: 'string(email)*', password: 'string*' },
  ChangePassword: { currentPassword: 'string*', newPassword: 'string(min 12, upper+lower+digit)*' },
  Quote: { items: '[{productId*, variantId, quantity 1-20*, customizations{key:value}}]*', couponCode: 'string', phone: 'string' },
  CreateOrder: { customer: '{name*, phone* (10-digit Indian mobile), whatsapp, email}', address: '{line1*, line2, city*, state*, pincode* (6 digits), landmark}', items: 'as Quote*', couponCode: 'string', customerNotes: 'string', giftMessage: 'string', expectedTotal: 'number (409 PRICE_CHANGED if differs from server total)' },
  CouponValidate: { code: 'string*', items: 'as Quote*', phone: 'string' },
  Review: { orderId: 'string*', phone: 'string*', productId: 'id*', rating: '1-5*', title: 'string', text: 'string*' },
  Product: { name: '*', sku: '*', slug: '', category: 'id*', subcategory: 'id|null', childCategory: 'id|null', price: 'number*', discountPrice: 'number|null (< price)', stock: 'int', lowStockThreshold: 'int', trackInventory: 'bool', variants: '[{label*, sku, price, discountPrice, stock}]', customFields: '[{key*, label*, type text|textarea|select|photo|message, required, options, maxLength}]', images: '[{url*, publicId, alt}]', isFeatured: 'bool', isBestseller: 'bool', isNewArrival: 'bool', keywords: '[string]', seoTitle: '', seoDescription: '', isActive: 'bool' },
  ProductStatus: { isActive: 'bool*' },
  StockAdjust: { variantId: 'id', delta: 'int', stock: 'int (exactly one of delta/stock)', reason: 'string*' },
  Category: { name: '*', slug: '', description: '', parent: 'id|null', image: '{url, publicId, alt}', displayOrder: 'int', isActive: 'bool' },
  OrderFilters: { q: '', status: '', paymentStatus: '', from: 'date', to: 'date' },
  OrderStatus: { status: 'enum*', note: '' },
  OrderNote: { note: 'string*' },
  OrderPayment: { paymentStatus: 'unpaid|partially_paid|paid*', amountCollected: 'number*' },
  OrderCancel: { reason: 'string*' },
  Coupon: { code: '*', type: 'percentage|fixed*', value: 'number*', minCartAmount: '', maxDiscount: '', startsAt: '', expiresAt: '', usageLimit: '', perCustomerLimit: '', products: '[id]', categories: '[id]', isActive: '' },
  Offer: { title: '*', description: '', image: '', startsAt: '', endsAt: '', isActive: '', couponCode: '', products: '[id]', categories: '[id]' },
  Banner: { title: '*', description: '', image: '{url*, alt}', ctaLabel: '', linkUrl: '', product: 'id', category: 'id', displayOrder: '', startsAt: '', endsAt: '', isActive: '' },
  ReviewModerate: { status: 'pending|approved|rejected*' },
  InventoryAdjust: { productId: 'id*', variantId: 'id', delta: 'int', stock: 'int', reason: 'string*' },
  Settings: { '(any subset of)': 'brandName, tagline, logoUrl, faviconUrl, contactEmail, businessPhone, whatsappNumber (digits), address, social{}, hero{}, announcement{}, footerText, shipping{flatRate, freeShippingThreshold, note}, coupons{enabled}, display{}, seo{}, maintenance{}' },
};

const spec = {
  openapi: '3.0.3',
  info: { title: 'The Crafters Workshop API', version: '1.0.0', description: 'Base path /api/v1. Success: {success:true,message,data,meta?}. Error: {success:false,message,code,details?}. Admin auth: HttpOnly cookie "cw_admin"; state-changing admin requests must send header X-CSRF-Token (returned by login and /auth/admin/me).' },
  servers: [{ url: 'http://localhost:5000/api/v1', description: 'Development' }],
  tags: [...new Set(E.map((e) => e[3]))].map((name) => ({ name })),
  paths: {},
  components: {
    securitySchemes: { adminCookie: { type: 'apiKey', in: 'cookie', name: 'cw_admin' }, csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' } },
    schemas: Object.fromEntries(Object.entries(schemas).map(([k, v]) => [k, { type: 'object', description: 'Field → type/rules. * = required', properties: Object.fromEntries(Object.entries(v).map(([f, d]) => [f, { description: d }])) }])),
    responses: {
      Error: { description: 'Error envelope', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: false }, message: { type: 'string' }, code: { type: 'string', example: 'VALIDATION_ERROR' }, details: {} } } } } },
    },
  },
};

for (const [method, path, auth, tag, summary, body] of E) {
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
  const op = {
    tags: [tag], summary, description: `Authorization: ${roles[auth]}`, parameters: params,
    responses: { 200: { description: 'Success envelope' }, 400: { $ref: '#/components/responses/Error' } },
  };
  if (auth !== 'public') { op.security = [{ adminCookie: [] }]; op.responses[401] = { $ref: '#/components/responses/Error' }; op.responses[403] = { $ref: '#/components/responses/Error' }; }
  if (body) op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${body}` } } } };
  if (path.includes('uploads')) op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { images: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } };
  if (method === 'post' && !path.includes('login') && !path.includes('validate') && !path.includes('quote') && !path.includes('logout') && !path.includes('export') && !path.includes('cancel') && !path.includes('adjust') && !path.includes('change')) op.responses[201] = { description: 'Created' };
  spec.paths[path] ||= {};
  spec.paths[path][method] = op;
}

const out = join(dirname(fileURLToPath(import.meta.url)), '../docs/openapi.json');
writeFileSync(out, JSON.stringify(spec, null, 2));
console.log(`OpenAPI written: ${E.length} operations → ${out}`);
