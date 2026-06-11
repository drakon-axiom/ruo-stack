import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  BrandProfilePatchSchema,
  BrandSignupSchema,
} from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireBrand } from '../middleware/guards.js';
import { BadRequest, Conflict, NotFound } from '../errors.js';

const NAME_LOCK_DAYS = 7;
const NAME_LOCK_MS = NAME_LOCK_DAYS * 24 * 60 * 60 * 1000;

/** Human-friendly, collision-resistant referral code (e.g. RUO-7F3K9Q). */
function makeReferralCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `RUO-${code}`;
}

export async function brandRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, supabaseAdmin } = getClients();

  // ── Signup: atomic Brand + owner BrandMember + BrandUserRole + auth.users ──
  // Critical invariant: a forced failure leaves NO orphan rows (compensating
  // delete of the auth user if the DB transaction fails).
  app.post('/api/brand/signup', async (req, reply) => {
    const body = BrandSignupSchema.parse(req.body);

    // 1. Create the Supabase auth.users row (service role). Email confirmation /
    //    password reset are delivered by Supabase Auth per project SMTP config
    //    (local dev: inbucket). We do not duplicate credentials in `public`.
    const created = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: false,
      user_metadata: { full_name: body.full_name },
    });
    if (created.error || !created.data.user) {
      // Most commonly a duplicate email.
      throw Conflict('email_taken', created.error?.message ?? 'Could not create user');
    }
    const userId = created.data.user.id;

    // 2. Atomically create the brand-side records, or roll back + delete the user.
    try {
      const brand = await prisma.$transaction(async (tx) => {
        const b = await tx.brand.create({
          data: {
            brandName: body.brand_name,
            referralCode: makeReferralCode(),
            referredBy: body.ref ?? null,
          },
        });
        await tx.userProfile.create({ data: { id: userId, fullName: body.full_name } });
        await tx.brandMember.create({
          data: { brandId: b.id, userId, role: 'owner', status: 'active' },
        });
        await tx.brandUserRole.create({ data: { userId, brandId: b.id, realm: 'brand' } });
        await writeAudit(tx, {
          actorType: 'brand',
          actorId: userId,
          action: AUDIT_ACTIONS.brandSignup,
          targetType: 'brand',
          targetId: b.id,
          after: { brand_name: b.brandName, referred_by: b.referredBy },
          ip: req.ip,
        });
        return b;
      });

      return reply.code(201).send({ brand_id: brand.id, user_id: userId, referral_code: brand.referralCode });
    } catch (err) {
      // Compensating action: remove the orphaned auth user so signup is all-or-nothing.
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
      throw err;
    }
  });

  // ── Me: profile + brand + membership ──────────────────────────────────────
  app.get('/api/brand/me', { preHandler: requireBrand }, async (req) => {
    const { userId, brandId } = req.brand!;
    const [profile, brand, membership] = await Promise.all([
      prisma.userProfile.findUnique({ where: { id: userId } }),
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } }),
    ]);
    if (!profile || !brand || !membership) throw NotFound('Account not found');

    return {
      profile: {
        id: profile.id,
        full_name: profile.fullName,
        name_last_changed_at: profile.nameLastChangedAt,
        name_editable: !profile.nameLastChangedAt || Date.now() - profile.nameLastChangedAt.getTime() >= NAME_LOCK_MS,
      },
      brand: {
        id: brand.id,
        brand_name: brand.brandName,
        website: brand.website,
        sales_channel: brand.salesChannel,
        logo_url: brand.logoUrl,
        subscription_status: brand.subscriptionStatus,
        member_since: brand.memberSince,
        referral_code: brand.referralCode,
      },
      membership: { role: membership.role, status: membership.status },
    };
  });

  // ── Patch profile (7-day name lock; audited as a sensitive brand action) ──
  app.patch('/api/brand/profile', { preHandler: requireBrand }, async (req) => {
    const { userId, brandId } = req.brand!;
    const body = BrandProfilePatchSchema.parse(req.body);

    const profile = await prisma.userProfile.findUnique({ where: { id: userId } });
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!profile || !brand) throw NotFound('Account not found');

    const before = {
      full_name: profile.fullName,
      brand_name: brand.brandName,
      website: brand.website,
      sales_channel: brand.salesChannel,
    };

    // Enforce "name editable once / 7 days" — server-side authority.
    let nameLastChangedAt = profile.nameLastChangedAt;
    if (body.full_name !== undefined && body.full_name !== profile.fullName) {
      const locked =
        profile.nameLastChangedAt && Date.now() - profile.nameLastChangedAt.getTime() < NAME_LOCK_MS;
      if (locked) {
        throw BadRequest('name_locked', `Name can only be changed once every ${NAME_LOCK_DAYS} days`);
      }
      nameLastChangedAt = new Date();
    }

    await prisma.$transaction(async (tx) => {
      if (body.full_name !== undefined) {
        await tx.userProfile.update({
          where: { id: userId },
          data: { fullName: body.full_name, nameLastChangedAt },
        });
      }
      const brandData: Record<string, unknown> = {};
      if (body.brand_name !== undefined) brandData.brandName = body.brand_name;
      if (body.website !== undefined) brandData.website = body.website || null;
      if (body.sales_channel !== undefined) brandData.salesChannel = body.sales_channel;
      if (Object.keys(brandData).length > 0) {
        await tx.brand.update({ where: { id: brandId }, data: brandData });
      }
      await writeAudit(tx, {
        actorType: 'brand',
        actorId: userId,
        action: AUDIT_ACTIONS.brandProfileUpdated,
        targetType: 'brand',
        targetId: brandId,
        before,
        after: {
          full_name: body.full_name ?? before.full_name,
          brand_name: body.brand_name ?? before.brand_name,
          website: body.website ?? before.website,
          sales_channel: body.sales_channel ?? before.sales_channel,
        },
        ip: req.ip,
      });
    });

    return { ok: true };
  });

  // ── Read-only catalog projection (published products only) ────────────────
  // Proves the seam: the brand catalog is a READ PROJECTION of CatalogProduct,
  // never independently written.
  app.get('/api/brand/catalog', { preHandler: requireBrand }, async () => {
    const products = await prisma.catalogProduct.findMany({
      where: { isPublished: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        canonicalSku: true,
        name: true,
        compound: true,
        dose: true,
        unit: true,
        descriptionTemplate: true,
        wholesaleCost: true,
        suggestedRetail: true,
        status: true,
        images: true,
        coaId: true,
      },
    });
    return { products };
  });
}
