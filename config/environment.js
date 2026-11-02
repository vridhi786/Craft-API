import 'dotenv/config';

const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

const list = (v) => (v || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  isTest,
  port: int(process.env.PORT, 5000),
  host: process.env.HOST || '0.0.0.0', // Render requires binding to all interfaces
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  // The API is a trusted server: it must use the service-role key (bypasses RLS). The anon key is only a fallback and
  // will NOT work with this schema, because every table has RLS enabled with no policies.
  supabaseKey: serviceKey || anonKey,
  usingServiceRole: Boolean(serviceKey),
  frontendOrigins: list(process.env.FRONTEND_ORIGIN),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieSameSite: (process.env.COOKIE_SAMESITE || (isProduction ? 'none' : 'lax')).toLowerCase(),
  whatsappNumber: (process.env.WHATSAPP_BUSINESS_NUMBER || '').replace(/\D/g, ''),
  siteUrl: (process.env.SITE_URL || '').replace(/\/$/, ''),
  trustProxy: int(process.env.TRUST_PROXY, isProduction ? 1 : 0),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  limits: {
    loginMax: int(process.env.LOGIN_RATE_LIMIT_MAX, 10),
    apiMax: int(process.env.API_RATE_LIMIT_MAX, 300),
    orderMax: int(process.env.ORDER_RATE_LIMIT_MAX, 20),
  },
};

/** Throws a readable error when mandatory configuration is missing. Called from server.js and the CLI scripts. */
export function assertEnvironment() {
  const problems = [];
  if (!env.supabaseUrl) problems.push('SUPABASE_URL is required (Supabase → Project Settings → API → Project URL)');
  else if (!/^https?:\/\//.test(env.supabaseUrl)) problems.push('SUPABASE_URL must start with https://');
  if (!env.supabaseKey) problems.push('SUPABASE_SERVICE_ROLE_KEY is required (Supabase → Project Settings → API → service_role key)');
  if (isProduction && !env.usingServiceRole) problems.push('Production needs SUPABASE_SERVICE_ROLE_KEY (the anon key cannot access RLS-protected tables)');
  if (env.jwtSecret.length < 32) problems.push('JWT_SECRET is required and must be at least 32 characters');
  if (env.frontendOrigins.length === 0) problems.push('FRONTEND_ORIGIN is required (comma-separated list of allowed website origins)');
  if (isProduction && env.frontendOrigins.some((o) => !o.startsWith('https://'))) problems.push('FRONTEND_ORIGIN must use https:// in production');
  if (problems.length) throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
}
