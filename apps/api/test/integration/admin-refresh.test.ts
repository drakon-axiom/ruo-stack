import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { adminAuthRoutes } from '../../src/routes/admin-auth.ts';
import { resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { hashToken, randomToken } from '../../src/crypto.ts';
const db = getPrisma();

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('atomic admin refresh', () => {
  let adminId: string;
  let sessionId: string;
  let refreshToken: string;
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    adminId = (await db.adminUser.create({ data: { email: `${randomToken(10)}@test.local`, fullName: 'Refresh', role: 'super_admin', passwordHash: 'unused', mfaEnabled: true } })).id;
    refreshToken = randomToken(32);
    sessionId = (await db.adminSession.create({ data: { adminUserId: adminId, refreshTokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now()+60000) } })).id;
  });
  afterEach(async () => { await app?.close(); resetClientsForTest(); await db.adminUser.delete({ where: { id: adminId } }); });
  afterAll(async () => { await db.$disconnect(); });
  async function build(client: PrismaClient = db) {
    setClientsForTest({ prisma: client }); app = Fastify(); await app.register(adminAuthRoutes);
  }
  const refresh = (token: unknown = refreshToken) => app.inject({ method: 'POST', url: '/auth/admin/refresh', payload: { refresh_token: token } });
  it('exchanges a refresh token only once under concurrent requests', async () => {
    let arrived = 0; let release!: () => void;
    const barrier = new Promise<void>(r => { release = r; });
    const client = db.$extends({ query: { adminSession: { async findUnique({ args, query }) {
      const result = await query(args); if (++arrived === 2) release(); await barrier; return result;
    } } } }) as unknown as PrismaClient;
    await build(client);
    const responses = await Promise.all([refresh(), refresh()]);
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,401]);
    expect(await db.adminSession.count({ where: { adminUserId: adminId, revokedAt: null } })).toBe(1);
    expect(await db.adminSession.count({ where: { adminUserId: adminId } })).toBe(2);
  });
  it('rolls back consumption if replacement session creation fails', async () => {
    const client = db.$extends({ query: { adminSession: { async create() { throw new Error('session insert failed'); } } } }) as unknown as PrismaClient;
    await build(client);
    expect((await refresh()).statusCode).toBe(500);
    expect((await db.adminSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt).toBeNull();
    expect(await db.adminSession.count({ where: { adminUserId: adminId } })).toBe(1);
  });
  it.each(['expired','revoked','suspended'] as const)('rejects %s sessions/accounts', async kind => {
    if(kind === 'suspended') await db.adminUser.update({ where: { id: adminId }, data: { status: 'suspended' } });
    else await db.adminSession.update({ where: { id: sessionId }, data: kind === 'expired' ? { expiresAt: new Date(0) } : { revokedAt: new Date() } });
    await build(); expect((await refresh()).statusCode).toBe(401);
    expect(await db.adminSession.count({ where: { adminUserId: adminId } })).toBe(1);
  });
  it('rejects malformed refresh tokens without server errors', async () => {
    await build(); expect((await refresh(123)).statusCode).toBe(401);
  });
  it('returns a usable replacement and rejects later replay', async () => {
    await build(); const first = await refresh(); expect(first.statusCode).toBe(200);
    expect((await refresh()).statusCode).toBe(401);
    expect((await refresh(first.json().refresh_token)).statusCode).toBe(200);
  });
});
