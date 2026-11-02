import { env } from './environment.js';
import { deepMerge } from '../utils/deepMerge.js';

export { deepMerge };

/** Default site settings (stored settings are deep-merged over these). No products or fake content. */
export const siteDefaults = () => ({
  brandName: 'The Crafters Workshop',
  tagline: 'Best Gift Ever',
  logoUrl: '',
  faviconUrl: '',
  contactEmail: '',
  businessPhone: '+91 9574546023',
  whatsappNumber: env.whatsappNumber || '',
  address: '',
  social: { instagram: 'https://www.instagram.com/the_crafters__workshop_07', facebook: '', youtube: '', pinterest: '' },
  hero: {
    title: 'Gifts made personal, crafted by hand.',
    subtitle: 'Personalised keepsakes, hampers and décor for the people who matter most.',
    image: '', imageAlt: '', primaryCtaLabel: 'Shop Now', secondaryCtaLabel: 'Explore Collections',
  },
  announcement: { enabled: false, text: '', link: '' },
  footerText: 'Handcrafted gifts, made with love.',
  shipping: { flatRate: 0, freeShippingThreshold: 0, note: '' },
  coupons: { enabled: true },
  display: { productsPerPage: 12, showReviews: true, showWhatsappInquiry: true, showLowStockCount: false },
  seo: { defaultTitle: 'The Crafters Workshop – Personalised Gifts', defaultDescription: 'Personalised and handcrafted gifts for every occasion.', ogImage: '' },
  maintenance: { enabled: false, message: 'We are making a few updates. Orders are paused for a short while.' },
  currency: 'INR',
});

export const PUBLIC_SETTINGS_FIELDS = [
  'brandName', 'tagline', 'logoUrl', 'faviconUrl', 'contactEmail', 'businessPhone', 'whatsappNumber', 'address', 'social', 'hero',
  'announcement', 'footerText', 'shipping', 'coupons', 'display', 'seo', 'maintenance', 'currency',
];
