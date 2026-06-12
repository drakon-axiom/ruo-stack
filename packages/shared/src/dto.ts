import { z } from 'zod';
import { ADMIN_ROLES } from './realm.js';

/** Shared API request schemas (validated with zod at the route boundary). */

// ── Brand realm ──────────────────────────────────────────────────────────────
export const BrandSignupSchema = z.object({
  full_name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  brand_name: z.string().min(1).max(120),
  ref: z.string().trim().min(1).max(64).optional(), // referral code → stored as referred_by
});
export type BrandSignup = z.infer<typeof BrandSignupSchema>;

export const BrandProfilePatchSchema = z
  .object({
    full_name: z.string().min(1).max(120).optional(), // server enforces 7-day lock
    brand_name: z.string().min(1).max(120).optional(),
    website: z.string().url().max(300).optional().or(z.literal('')),
    sales_channel: z.string().max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type BrandProfilePatch = z.infer<typeof BrandProfilePatchSchema>;

// ── Admin realm ──────────────────────────────────────────────────────────────
export const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(), // required once MFA enrolled
});
export type AdminLogin = z.infer<typeof AdminLoginSchema>;

export const AdminMfaVerifySchema = z.object({
  totp: z.string().regex(/^\d{6}$/),
});

export const CatalogStatusEnum = z.enum(['in_stock', 'soon', 'out_of_stock']);

export const CatalogCreateSchema = z.object({
  canonical_sku: z.string().min(1).max(64), // settable only while unpublished
  compound: z.string().min(1).max(120),
  dose: z.string().max(60).optional(),
  unit: z.string().max(30).optional(),
  name: z.string().min(1).max(200),
  description_template: z.string().max(5000).optional(),
  // Tiered wholesale cost (cents) — one per plan; higher tiers get better rates.
  wholesale_starter: z.number().int().nonnegative(),
  wholesale_pro: z.number().int().nonnegative(),
  wholesale_volume: z.number().int().nonnegative(),
  suggested_retail: z.number().int().nonnegative(), // cents (operator suggestion)
  status: CatalogStatusEnum.default('soon'),
  weight: z.number().nonnegative().optional(),
  length: z.number().nonnegative().optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  packaging_rule: z.string().max(200).optional(),
  coa_id: z.string().max(120).optional(),
  images: z.array(z.string().url()).default([]),
});
export type CatalogCreate = z.infer<typeof CatalogCreateSchema>;

// On edit, canonical_sku is REJECTED server-side once is_published is true.
export const CatalogUpdateSchema = CatalogCreateSchema.partial();
export type CatalogUpdate = z.infer<typeof CatalogUpdateSchema>;

export const CatalogStockSchema = z.object({ status: CatalogStatusEnum });

export const AdminCreateSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(120),
  role: z.enum(ADMIN_ROLES),
});
export type AdminCreate = z.infer<typeof AdminCreateSchema>;

export const AdminRolePatchSchema = z.object({ role: z.enum(ADMIN_ROLES) });
export const AdminStatusPatchSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().max(500).optional(),
});

export const AuditQuerySchema = z.object({
  actor_type: z.enum(['admin', 'brand', 'system']).optional(),
  actor_id: z.string().optional(),
  action: z.string().optional(),
  target_type: z.string().optional(),
  target_id: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
