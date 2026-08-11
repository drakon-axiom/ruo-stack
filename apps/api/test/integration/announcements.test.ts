import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { randomUUID } from 'node:crypto';
import { hashToken, randomToken, hashPassword } from '../../src/crypto.ts';
import { getFeed, getUnreadCount, markAllRead, markRead } from '../../src/services/notifications.ts';

// Announcements + the derived brand inbox, against a real migrated Postgres.
// Self-skips unless RUN_DB_TESTS=1 (CI's db-tests job sets it).
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

const uuid = () => randomUUID();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Announce Admin',
      role,
      passwordHash: await hashPassword('x'),
      status: 'active',
      mfaEnabled: true,
    },
  });
  const session = await prisma.adminSession.create({
    data: { adminUserId: admin.id, refreshTokenHash: hashToken(randomToken(32)), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { admin, token: signAdminAccessToken({ sub: admin.id, role, sid: session.id }) };
}

describe.skipIf(!RUN)('announcements + notifications inbox (DB integration)', () => {
  let app: FastifyInstance;
  let superToken: string;
  let supportToken: string;
  let adminIds: string[] = [];
  let brandA: string;
  let brandB: string;
  const userA = uuid();
  const userA2 = uuid(); // a second staff user under brand A
  const userB = uuid();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const sup = await seedAdmin('super_admin');
    const sec = await seedAdmin('support');
    superToken = sup.token;
    supportToken = sec.token;
    adminIds = [sup.admin.id, sec.admin.id];

    const a = await prisma.brand.create({ data: { brandName: 'Announce A', referralCode: `AA-${randomToken(5)}` } });
    const b = await prisma.brand.create({ data: { brandName: 'Announce B', referralCode: `AB-${randomToken(5)}` } });
    brandA = a.id;
    brandB = b.id;
  });

  afterAll(async () => {
    await prisma.announcement.deleteMany({ where: { OR: [{ brandId: brandA }, { brandId: brandB }, { createdBy: { in: adminIds } }] } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  const post = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/admin/announcements', headers: { authorization: `Bearer ${token}` }, payload });
  const patch = (token: string, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/admin/announcements/${id}`, headers: { authorization: `Bearer ${token}` }, payload });

  it('support can read the admin list but cannot author (role gate is server-side)', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/admin/announcements', headers: { authorization: `Bearer ${supportToken}` } });
    expect(list.statusCode).toBe(200);

    const denied = await post(supportToken, { title: 'Nope', body: 'should not be allowed' });
    expect(denied.statusCode).toBe(403);
  });

  it('a new announcement lands as a draft and is invisible until published', async () => {
    const created = await post(superToken, { title: 'Platform news', body: 'Hello brands' });
    expect(created.statusCode).toBe(201);
    const { id, status, display_state } = created.json();
    expect(status).toBe('draft');
    expect(display_state).toBe('draft');

    expect(await getUnreadCount(prisma, brandA, userA)).toBe(0);

    const published = await patch(superToken, id, { status: 'published' });
    expect(published.statusCode).toBe(200);
    expect(published.json().display_state).toBe('live');

    const feed = await getFeed(prisma, brandA, userA);
    expect(feed.map((f) => f.id)).toContain(id);
    expect(await getUnreadCount(prisma, brandA, userA)).toBe(1);
  });

  it('a single_brand announcement reaches only its own brand', async () => {
    const created = await post(superToken, {
      audience: 'single_brand',
      brand_id: brandA,
      title: 'Just for A',
      body: 'private note',
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    await patch(superToken, id, { status: 'published' });

    expect((await getFeed(prisma, brandA, userA)).map((f) => f.id)).toContain(id);
    expect((await getFeed(prisma, brandB, userB)).map((f) => f.id)).not.toContain(id);

    // And brand B cannot mark it read by guessing the id.
    expect(await markRead(prisma, brandB, userB, id)).toBeNull();
  });

  it('rejects an audience/brand_id mismatch in both directions', async () => {
    const missingBrand = await post(superToken, { audience: 'single_brand', title: 't', body: 'b' });
    expect(missingBrand.statusCode).toBe(400);

    const strayBrand = await post(superToken, { audience: 'all_brands', brand_id: brandA, title: 't', body: 'b' });
    expect(strayBrand.statusCode).toBe(400);
  });

  it('hides scheduled and expired announcements from the feed', async () => {
    const future = await post(superToken, {
      title: 'Scheduled',
      body: 'later',
      publish_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const futureId = future.json().id;
    const scheduled = await patch(superToken, futureId, { status: 'published' });
    expect(scheduled.json().display_state).toBe('scheduled');

    const expired = await post(superToken, {
      title: 'Expired',
      body: 'over',
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const expiredId = expired.json().id;
    await patch(superToken, expiredId, { status: 'published' });

    const ids = (await getFeed(prisma, brandA, userA)).map((f) => f.id);
    expect(ids).not.toContain(futureId);
    expect(ids).not.toContain(expiredId);
  });

  it('read receipts are per user, and marking read is idempotent', async () => {
    const created = await post(superToken, { title: 'Read tracking', body: 'x' });
    const { id } = created.json();
    await patch(superToken, id, { status: 'published' });

    const before = await getUnreadCount(prisma, brandA, userA);
    const firstReadAt = await markRead(prisma, brandA, userA, id);
    expect(firstReadAt).not.toBeNull();
    expect(await getUnreadCount(prisma, brandA, userA)).toBe(before - 1);

    // Idempotent: the second read keeps the original timestamp.
    const secondReadAt = await markRead(prisma, brandA, userA, id);
    expect(secondReadAt?.getTime()).toBe(firstReadAt?.getTime());

    // A different user under the same brand still has it unread.
    const feedA2 = await getFeed(prisma, brandA, userA2);
    expect(feedA2.find((f) => f.id === id)?.read_at).toBeNull();
  });

  it('read-all clears the badge and is safe to repeat', async () => {
    const marked = await markAllRead(prisma, brandA, userA);
    expect(marked).toBeGreaterThan(0);
    expect(await getUnreadCount(prisma, brandA, userA)).toBe(0);
    expect(await markAllRead(prisma, brandA, userA)).toBe(0);

    expect((await getFeed(prisma, brandA, userA, { unreadOnly: true })).length).toBe(0);
  });

  it('archiving pulls an announcement back out of every inbox', async () => {
    const created = await post(superToken, { title: 'Temporary', body: 'oops' });
    const { id } = created.json();
    await patch(superToken, id, { status: 'published' });
    expect((await getFeed(prisma, brandB, userB)).map((f) => f.id)).toContain(id);

    const archived = await patch(superToken, id, { status: 'archived' });
    expect(archived.json().display_state).toBe('archived');
    expect((await getFeed(prisma, brandB, userB)).map((f) => f.id)).not.toContain(id);
  });

  it('only drafts can be deleted; published ones must be archived', async () => {
    const draft = await post(superToken, { title: 'Draft to delete', body: 'x' });
    const draftId = draft.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/announcements/${draftId}`, headers: { authorization: `Bearer ${superToken}` } });
    expect(del.statusCode).toBe(200);

    const live = await post(superToken, { title: 'Published, undeletable', body: 'x' });
    const liveId = live.json().id;
    await patch(superToken, liveId, { status: 'published' });
    const refused = await app.inject({ method: 'DELETE', url: `/api/admin/announcements/${liveId}`, headers: { authorization: `Bearer ${superToken}` } });
    expect(refused.statusCode).toBe(400);
  });

  it('writes an audit entry naming who published', async () => {
    const created = await post(superToken, { title: 'Audited', body: 'x' });
    const { id } = created.json();
    await patch(superToken, id, { status: 'published' });

    const entries = await prisma.auditLog.findMany({ where: { targetType: 'announcement', targetId: id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['announcement.created', 'announcement.published']);
    expect(entries[1]?.actorType).toBe('admin');
  });
});
