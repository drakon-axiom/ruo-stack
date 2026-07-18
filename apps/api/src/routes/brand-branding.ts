import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireBrand } from '../middleware/guards.js';
import { BadRequest, NotFound } from '../errors.js';

// Public bucket holding brand logos. Self-provisioned on first upload so there's
// no manual Supabase setup step. Served from the storage domain (isolated from
// the app origin), referenced from brand.logo_url.
const LOGO_BUCKET = 'brand-logos';
const MAX_LOGO_BYTES = 512 * 1024; // 512 KB raw (base64 body stays under the 1 MB API limit)
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const hexColor = z.string().regex(HEX, 'Must be a hex color like #1e293b');

const LogoUploadSchema = z.object({
  // A data URL: data:image/png;base64,<payload>
  data_url: z.string().startsWith('data:', 'Expected a data URL'),
});
const BrandingPatchSchema = z.object({
  primary_color: hexColor.nullable().optional(),
  accent_color: hexColor.nullable().optional(),
});

/** Parse + validate a data URL into a decoded buffer, its mime, and file extension. */
function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string; ext: string } {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!m || !m[1] || !m[2]) throw BadRequest('bad_image', 'Logo must be a base64 data URL');
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw BadRequest('unsupported_type', 'Logo must be a PNG, JPEG, WebP, or SVG');
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) throw BadRequest('bad_image', 'Logo image is empty');
  if (buffer.length > MAX_LOGO_BYTES) throw BadRequest('too_large', 'Logo must be 512 KB or smaller');
  return { buffer, mime, ext };
}

/**
 * Brand branding — logo (Supabase Storage) + theme colors. Colors are stored for
 * use on brand-facing surfaces; the portal chrome stays on the shared theme for
 * now. Every route is brand-scoped via requireBrand.
 */
export async function brandBrandingRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, supabaseAdmin } = getClients();
  const storage = supabaseAdmin.storage;

  // Idempotently ensure the public logo bucket exists (createBucket is a no-op
  // once created — we ignore the "already exists" error).
  async function ensureBucket(): Promise<void> {
    const { error } = await storage.createBucket(LOGO_BUCKET, { public: true });
    if (error && !/exist/i.test(error.message)) throw error;
  }

  // ── Upload / replace logo ──────────────────────────────────────────────────
  app.post('/api/brand/logo', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { data_url } = LogoUploadSchema.parse(req.body);
    const { buffer, mime, ext } = parseDataUrl(data_url);

    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { logoUrl: true } });
    if (!brand) throw NotFound('Brand not found');

    await ensureBucket();
    // Stable, cache-busted path per brand: overwrite replaces the previous logo.
    const path = `${brandId}/logo.${ext}`;
    const up = await storage.from(LOGO_BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
    if (up.error) throw new Error(`Logo upload failed: ${up.error.message}`);

    // Overwrite only replaces the same extension — a format change (png → webp)
    // would otherwise orphan the old file. Best-effort sweep of the other exts.
    const stale = Object.values(MIME_EXT).filter((e) => e !== ext).map((e) => `${brandId}/logo.${e}`);
    await storage.from(LOGO_BUCKET).remove(stale).catch(() => undefined);

    const { data: pub } = storage.from(LOGO_BUCKET).getPublicUrl(path);
    // Cache-bust so a replaced logo (same path) refreshes in the browser.
    const logoUrl = `${pub.publicUrl}?v=${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      await tx.brand.update({ where: { id: brandId }, data: { logoUrl } });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId: userId,
        action: AUDIT_ACTIONS.brandBrandingUpdated,
        targetType: 'brand',
        targetId: brandId,
        before: { logo_url: brand.logoUrl },
        after: { logo_url: logoUrl, bytes: buffer.length, mime },
        ip: req.ip,
      });
    });

    return { logo_url: logoUrl };
  });

  // ── Remove logo ────────────────────────────────────────────────────────────
  app.delete('/api/brand/logo', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { logoUrl: true } });
    if (!brand) throw NotFound('Brand not found');
    if (!brand.logoUrl) return { logo_url: null };

    // Best-effort remove every extension we might have written for this brand.
    await storage.from(LOGO_BUCKET).remove(Object.values(MIME_EXT).map((e) => `${brandId}/logo.${e}`)).catch(() => undefined);

    await prisma.$transaction(async (tx) => {
      await tx.brand.update({ where: { id: brandId }, data: { logoUrl: null } });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId: userId,
        action: AUDIT_ACTIONS.brandBrandingUpdated,
        targetType: 'brand',
        targetId: brandId,
        before: { logo_url: brand.logoUrl },
        after: { logo_url: null },
        ip: req.ip,
      });
    });

    return { logo_url: null };
  });

  // ── Set theme colors ───────────────────────────────────────────────────────
  app.patch('/api/brand/branding', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const body = BrandingPatchSchema.parse(req.body);

    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { primaryColor: true, accentColor: true } });
    if (!brand) throw NotFound('Brand not found');

    const data: { primaryColor?: string | null; accentColor?: string | null } = {};
    if (body.primary_color !== undefined) data.primaryColor = body.primary_color;
    if (body.accent_color !== undefined) data.accentColor = body.accent_color;
    if (Object.keys(data).length === 0) throw BadRequest('nothing_to_update', 'No colors provided');

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.brand.update({ where: { id: brandId }, data });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId: userId,
        action: AUDIT_ACTIONS.brandBrandingUpdated,
        targetType: 'brand',
        targetId: brandId,
        before: { primary_color: brand.primaryColor, accent_color: brand.accentColor },
        after: { primary_color: b.primaryColor, accent_color: b.accentColor },
        ip: req.ip,
      });
      return b;
    });

    return { primary_color: updated.primaryColor, accent_color: updated.accentColor };
  });
}
