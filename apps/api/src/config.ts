import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// Load the monorepo-root .env regardless of cwd (works from src via tsx and from
// dist). Skipped under tests, where env is set explicitly in test/setup.ts.
// `override:false` (dotenv default) means real exported vars always win.
if (process.env.NODE_ENV !== 'test') {
  loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env') });
}

/**
 * All secrets via env, validated with zod at boot. The app REFUSES TO START if
 * any required var is missing (critical invariant #6). The service-role key is
 * server-only and never reaches a frontend.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Prisma ↔ Supabase Postgres (used by Prisma; presence validated here).
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  // Supabase (server).
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Optional HS256 legacy secret — only needed if the project signs JWTs
  // symmetrically. Modern projects verify via JWKS (no secret required).
  SUPABASE_JWT_SECRET: z.string().optional(),

  // Admin realm (option a) — kept OUT of the customer pool.
  JWT_ADMIN_SECRET: z.string().min(32, 'JWT_ADMIN_SECRET must be ≥32 chars'),
  JWT_ADMIN_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_ADMIN_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  // base64 of exactly 32 bytes (AES-256-GCM key for AdminUser.mfa_secret at rest).
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'MFA_ENCRYPTION_KEY must be base64 of 32 bytes'),

  // Stripe (behind PaymentsAdapter only).
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  STRIPE_VOLUME_PRICE_ID: z.string().optional(),

  // Shipping / rates. Origin = RUOStack's fulfillment warehouse (ship-from).
  WAREHOUSE_NAME: z.string().default('RUOStack Fulfillment'),
  WAREHOUSE_FROM_STREET: z.string().default('123 Warehouse Way'),
  WAREHOUSE_FROM_CITY: z.string().default('Los Angeles'),
  WAREHOUSE_FROM_ZIP: z.string().default('90001'),
  WAREHOUSE_FROM_STATE: z.string().default('CA'),
  WAREHOUSE_PHONE: z.string().default('5555550100'),
  // ShipStation (optional — falls back to the computed rater if absent).
  SHIPSTATION_API_KEY: z.string().optional(),
  SHIPSTATION_API_SECRET: z.string().optional(),
  // Carrier codes to rate against (comma-sep); if absent, all configured carriers.
  SHIPSTATION_CARRIER_CODES: z.string().optional(),
  // ShipStation Custom Store (fulfillment). ShipStation polls our export endpoint
  // and POSTs shipnotify, authenticating with HTTP Basic using these credentials.
  // When unset, the custom-store endpoint refuses all requests (401).
  SHIPSTATION_STORE_USER: z.string().optional(),
  SHIPSTATION_STORE_PASS: z.string().optional(),
  // Default true so dev/verification never buys real postage. Set false for prod.
  SHIPSTATION_TEST_LABELS: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  // Pick-&-pack fee (cents) — RUOStack's hidden margin baked into every live rate
  // (global default; per-brand override lives in BrandShippingConfig). Default $2.50.
  SHIPPING_PICKPACK_FEE_CENTS: z.coerce.number().int().min(0).default(250),
  // Dimensional-weight divisor (cubic inches per pound) for billable weight.
  // Carrier standard is 166 for domestic.
  SHIPPING_DIM_DIVISOR: z.coerce.number().int().positive().default(166),
  // Usable fraction of a box's inner volume (packing can't reach 100%). Box-fit
  // compares item volume against innerVolume × this factor. Default 0.85.
  SHIPPING_BOX_FILL_FACTOR: z.coerce.number().min(0.1).max(1).default(0.85),
  // Carrier-rate cache TTL (seconds) — short, so checkout never hammers the rater.
  RATE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // RateQuote validity (seconds) — covers checkout → order-import; reserve uses it.
  RATE_QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  // How often the API sweeps expired RateQuote rows. Default hourly.
  RATE_QUOTE_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
  // How often the reconciliation worker runs (retry stuck webhooks + drift scan).
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),

  // Publicly reachable base URL of this API (no trailing slash), used to build
  // webhook delivery URLs registered on external services (WooCommerce, etc.).
  // When unset, webhook auto-registration is skipped and the URL is surfaced for
  // manual setup — dev (private Tailscale IP) verifies by simulating webhooks.
  PUBLIC_API_BASE_URL: z.string().url().optional(),

  // API.
  API_PORT: z.coerce.number().int().positive().default(3901),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3902,http://localhost:3903'),

  // Bootstrap (seed:superadmin).
  SEED_SUPERADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPERADMIN_PASSWORD: z.string().min(8).optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & { corsOrigins: string[] };

let _config: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (_config) return _config;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Refuse to start with a clear, actionable message.
    throw new Error(`Invalid/missing environment configuration:\n${issues}`);
  }
  _config = {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  };
  return _config;
}
