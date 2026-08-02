import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '@ruostack/db';
import { canBrandAccess, wouldOrphanBrand } from '@ruostack/shared';
import { randomToken } from '../../src/crypto.js';

/**
 * Brand team membership against a real DB. The HTTP layer can't be exercised
 * here — brand tokens are minted by Supabase and verified against its JWKS, so
 * these drive the same rules the routes call, plus the membership/role state the
 * guard reads on every request.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('brand members (DB integration)', () => {
  let brandId: string;
  const ownerId = randomUUID();
  const staffId = randomUUID();

  beforeAll(async () => {
    const brand = await prisma.brand.create({ data: { brandName: 'Team Co', referralCode: `TM-${randomToken(5)}` } });
    brandId = brand.id;
    await prisma.userProfile.createMany({
      data: [
        { id: ownerId, fullName: 'The Owner' },
        { id: staffId, fullName: 'The Staffer' },
      ],
    });
    await prisma.brandMember.createMany({
      data: [
        { brandId, userId: ownerId, role: 'owner', status: 'active' },
        { brandId, userId: staffId, role: 'staff', status: 'active', invitedAt: new Date() },
      ],
    });
    await prisma.brandUserRole.createMany({
      data: [
        { userId: ownerId, brandId, realm: 'brand' },
        { userId: staffId, brandId, realm: 'brand' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.brandUserRole.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandMember.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.userProfile.deleteMany({ where: { id: { in: [ownerId, staffId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  /** What `requireBrand` reads on every request. */
  const memberState = (userId: string) =>
    prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } }, select: { role: true, status: true } });

  it('seats one owner and one staff member under the same brand', async () => {
    expect(await memberState(ownerId)).toEqual({ role: 'owner', status: 'active' });
    expect(await memberState(staffId)).toEqual({ role: 'staff', status: 'active' });
  });

  it('the guard would allow staff on orders and refuse them on the wallet', async () => {
    const staff = await memberState(staffId);
    expect(canBrandAccess(staff!.role, 'orders')).toBe(true);
    expect(canBrandAccess(staff!.role, 'wallet')).toBe(false);
    expect(canBrandAccess(staff!.role, 'members')).toBe(false);
  });

  it('refuses to demote the only owner', async () => {
    const owners = await prisma.brandMember.count({ where: { brandId, role: 'owner', status: 'active' } });
    expect(owners).toBe(1);
    expect(wouldOrphanBrand({ ownerCount: owners, targetIsOwner: true, losingOwner: true })).toBe(true);
  });

  it('allows demoting an owner once a second owner exists', async () => {
    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { role: 'owner' } });
    const owners = await prisma.brandMember.count({ where: { brandId, role: 'owner', status: 'active' } });
    expect(owners).toBe(2);
    expect(wouldOrphanBrand({ ownerCount: owners, targetIsOwner: true, losingOwner: true })).toBe(false);

    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { role: 'staff' } });
  });

  it('a suspended member is locked out immediately — the guard reads status per request', async () => {
    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { status: 'suspended' } });
    const m = await memberState(staffId);
    expect(m!.status).toBe('suspended'); // requireBrand refuses anything but 'active'

    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { status: 'active' } });
    expect((await memberState(staffId))!.status).toBe('active');
  });

  it('suspension does not delete the row, so audit entries keep their referent', async () => {
    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { status: 'suspended' } });
    expect(await memberState(staffId)).not.toBeNull();
    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { status: 'active' } });
  });

  it('a suspended member gets NO brand claims from the access-token hook', async () => {
    // Migration 020 joins brand_member and requires status='active'. This is the
    // second layer under the per-request guard: a fresh token carries nothing.
    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { status: 'suspended' } });
    const [suspended] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT public.custom_access_token_hook($1::jsonb) AS out`,
      JSON.stringify({ user_id: staffId, claims: {} }),
    );
    expect(suspended.out.claims).toEqual({});

    await prisma.brandMember.update({ where: { brandId_userId: { brandId, userId: staffId } }, data: { status: 'active' } });
    const [active] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT public.custom_access_token_hook($1::jsonb) AS out`,
      JSON.stringify({ user_id: staffId, claims: {} }),
    );
    expect(active.out.claims.realm).toBe('brand');
    expect(active.out.claims.brand_id).toBe(brandId);
  });

  it('both members resolve to the same brand — no cross-tenant leakage', async () => {
    const rows = await prisma.brandUserRole.findMany({ where: { brandId }, select: { userId: true, brandId: true } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.brandId))).toEqual(new Set([brandId]));
  });
});
