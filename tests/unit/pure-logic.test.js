import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, fromPaise, percentOfPaise, discountPercent } from '../../utils/money.js';
import { unitPrice, productAvailability, minimumPrice, availableStock } from '../../utils/pricing.js';
import { calculateCouponDiscount } from '../../utils/couponMath.js';
import { canTransition, isCancellable, TRANSITIONS, ORDER_STATUSES } from '../../utils/orderStatus.js';
import { normalizeIndianPhone } from '../../utils/phone.js';
import { slugify } from '../../utils/slugify.js';
import { generateOrderId } from '../../utils/generateOrderId.js';
import { detectImageType } from '../../utils/imageType.js';
import { stripOperatorKeys, cleanText } from '../../utils/sanitizeInput.js';
import { buildWhatsAppUrl, buildCustomerUpdateMessage } from '../../services/whatsappService.js';
import { flatten } from '../../utils/flatten.js';

test('money: paise maths avoids float drift', () => {
  assert.equal(toPaise(0.1) + toPaise(0.2), 30);
  assert.equal(fromPaise(toPaise(499.99) * 3), 1499.97);
  assert.equal(percentOfPaise(99900, 15), 14985);
  assert.equal(discountPercent(1000, 750), 25);
  assert.equal(discountPercent(1000, 1000), 0);
});

test('pricing: discount only counts when lower than regular price', () => {
  assert.deepEqual(unitPrice({ price: 500, discountPrice: 400 }), { mrp: 500, price: 400, discountPercent: 20 });
  assert.equal(unitPrice({ price: 500, discountPrice: 500 }).discountPercent, 0);
  assert.equal(unitPrice({ price: 500, discountPrice: 700 }).price, 500);
  assert.equal(unitPrice({ price: 500, discountPrice: null }).price, 500);
});

test('pricing: variant price overrides product price', () => {
  const p = { price: 500, discountPrice: 450, variants: [] };
  assert.equal(unitPrice(p, { price: 800 }).price, 800);
  assert.equal(unitPrice(p, { price: 800, discountPrice: 700 }).price, 700);
  assert.equal(unitPrice(p, {}).price, 450); // inherits product sale price
  assert.equal(minimumPrice({ price: 500, variants: [{ price: 800 }, { price: 600, isActive: true }, { price: 100, isActive: false }] }), 600);
});

test('inventory availability', () => {
  assert.equal(productAvailability({ stock: 0, variants: [] }), 'out_of_stock');
  assert.equal(productAvailability({ stock: 2, lowStockThreshold: 3, variants: [] }), 'low_stock');
  assert.equal(productAvailability({ stock: 10, lowStockThreshold: 3, variants: [] }), 'in_stock');
  assert.equal(productAvailability({ stock: 0, trackInventory: false, variants: [] }), 'in_stock');
  assert.equal(productAvailability({ lowStockThreshold: 3, variants: [{ stock: 0 }, { stock: 0 }] }), 'out_of_stock');
  assert.equal(availableStock({ trackInventory: false, stock: 0 }), Infinity);
});

test('coupon maths: percentage cap, fixed, never exceeds eligible amount', () => {
  assert.equal(calculateCouponDiscount({ type: 'percentage', value: 20 }, 100000), 20000);
  assert.equal(calculateCouponDiscount({ type: 'percentage', value: 20, maxDiscount: 100 }, 100000), 10000);
  assert.equal(calculateCouponDiscount({ type: 'fixed', value: 150 }, 100000), 15000);
  assert.equal(calculateCouponDiscount({ type: 'fixed', value: 5000 }, 100000), 100000);
  assert.equal(calculateCouponDiscount({ type: 'fixed', value: 50 }, 0), 0);
});

test('order status transitions', () => {
  assert.ok(canTransition('pending_confirmation', 'confirmed'));
  assert.ok(!canTransition('pending_confirmation', 'shipped'));
  assert.ok(!canTransition('delivered', 'cancelled'));
  assert.ok(!canTransition('cancelled', 'confirmed'));
  assert.ok(isCancellable('processing'));
  assert.ok(!isCancellable('shipped'));
  for (const s of ORDER_STATUSES) assert.ok(s in TRANSITIONS);
});

test('phone normalisation', () => {
  assert.equal(normalizeIndianPhone('+91 95745 46023'), '9574546023');
  assert.equal(normalizeIndianPhone('09574546023'), '9574546023');
  assert.equal(normalizeIndianPhone('919574546023'), '9574546023');
  assert.equal(normalizeIndianPhone('12345'), null);
  assert.equal(normalizeIndianPhone('5574546023'), null);
});

test('slugify', () => {
  assert.equal(slugify('Personalised Mug & Coaster Set!'), 'personalised-mug-and-coaster-set');
  assert.equal(slugify('  Crème Brûlée '), 'creme-brulee');
});

test('order ids look right and are not sequential', () => {
  const a = generateOrderId(new Date('2026-03-05T10:00:00Z'));
  assert.match(a, /^CW-260305-[A-Z2-9]{6}$/);
  assert.notEqual(generateOrderId(), generateOrderId());
});

test('image magic bytes', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), 'image/png');
  assert.equal(detectImageType(Buffer.from('RIFF0000WEBPVP8 ')), 'image/webp');
  assert.equal(detectImageType(Buffer.from('<?php echo 1; ?> padding')), null);
  assert.equal(detectImageType(Buffer.from('GIF89a000000000000')), null);
});

test('operator-key stripping and text cleaning', () => {
  const body = { email: { $gt: '' }, nested: { 'a.b': 1, ok: 2 }, list: [{ $where: 'x', fine: 1 }] };
  stripOperatorKeys(body);
  assert.deepEqual(body, { email: {}, nested: { ok: 2 }, list: [{ fine: 1 }] });
  assert.equal(cleanText('  <script>alert(1)</script>Hello  '), 'alert(1)Hello');
});

test('WhatsApp url: digits only, URL-encoded, readable', () => {
  const url = buildWhatsAppUrl('+91 95745-46023', 'Hello & welcome\nOrder #1');
  assert.equal(url, 'https://wa.me/919574546023?text=Hello%20%26%20welcome%0AOrder%20%231');
  assert.equal(buildWhatsAppUrl('', 'x'), null);
  const msg = buildCustomerUpdateMessage({ customer: { name: 'Asha' }, orderId: 'CW-1', status: 'confirmed', total: 1499.5 }, 'The Crafters Workshop');
  assert.match(msg, /CW-1/);
  assert.match(msg, /Confirmed/);
  assert.match(msg, /₹1,499\.5/);
});

test('settings flatten keeps siblings safe', () => {
  assert.deepEqual(flatten({ hero: { title: 'x' }, brandName: 'y', announcement: { enabled: true } }), { 'hero.title': 'x', brandName: 'y', 'announcement.enabled': true });
});
