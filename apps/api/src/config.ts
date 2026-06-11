import { z } from 'zod';

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
  STRIPE_MEMBERSHIP_PRICE_ID: z.string().optional(),

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
