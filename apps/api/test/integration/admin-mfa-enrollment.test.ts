import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { adminAuthRoutes } from '../../src/routes/admin-auth.ts';
import { hashPassword, randomToken } from '../../src/crypto.ts';

const db = getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('atomic admin MFA enrollment', () => {
  let app: ReturnType<typeof Fastify>;
  let admin: { id: string; email: string };
  let passwordHash: string;
  beforeAll(async () => { passwordHash = await hashPassword('test-password'); });
  beforeEach(async () => {
    admin = await db.adminUser.create({ data: { email: `${randomToken(8).toLowerCase()}@test.local`, fullName: 'MFA test', role: 'super_admin', passwordHash } });
    app = Fastify();
    await app.register(adminAuthRoutes);
  });
  afterEach(async () => { await app.close(); await db.adminUser.delete({ where: { id: admin.id } }); });
  afterAll(async () => { await db.$disconnect(); });
  async function login() {
    const res = await app.inject({ method: 'POST', url: '/auth/admin/login', payload: { email: admin.email, password: 'test-password' } });
    expect(res.statusCode).toBe(200);
    return res.json().enrollment_token as string;
  }
  const enroll = (token: string) => app.inject({ method: 'POST', url: '/auth/admin/mfa/enroll', headers: { authorization: `Bearer ${token}` } });
  const verify = (token: string, secret: string) => app.inject({ method: 'POST', url: '/auth/admin/mfa/verify', headers: { authorization: `Bearer ${token}` }, payload: { totp: authenticator.generate(secret) } });

  it('cannot reset an enabled factor with a completed enrollment token', async () => {
    const token = await login();
    const secret = (await enroll(token)).json().secret;
    expect((await verify(token, secret)).statusCode).toBe(200);
    const before = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect((await enroll(token)).statusCode).toBe(401);
    expect((await verify(token, secret)).statusCode).toBe(401);
    const after = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.mfaEnabled).toBe(true);
    expect(after.mfaSecret).toBe(before.mfaSecret);
    expect(await db.adminSession.count({ where: { adminUserId: admin.id } })).toBe(1);
  });
  it('keeps the same pending secret when enrollment is retried', async () => {
    const token = await login();
    const first = await enroll(token);
    expect(first.statusCode).toBe(200);
    expect((await enroll(token)).json().secret).toBe(first.json().secret);
  });
  it('rejects an earlier attempt after another password-verified login', async () => {
    const old = await login();
    const secret = (await enroll(old)).json().secret;
    const current = await login();
    expect((await enroll(old)).statusCode).toBe(401);
    expect((await verify(old, secret)).statusCode).toBe(401);
    expect((await enroll(current)).statusCode).toBe(200);
  });
  it('rejects enrollment and verification after suspension', async () => {
    const token = await login();
    const secret = (await enroll(token)).json().secret;
    await db.adminUser.update({ where: { id: admin.id }, data: { status: 'suspended' } });
    expect((await enroll(token)).statusCode).toBe(401);
    expect((await verify(token, secret)).statusCode).toBe(401);
    expect(await db.adminSession.count({ where: { adminUserId: admin.id } })).toBe(0);
  });
  it('enforces server-side expiry even when the signed token remains valid', async () => {
    const token = await login();
    const secret = (await enroll(token)).json().secret;
    await db.adminUser.update({ where: { id: admin.id }, data: { mfaEnrollmentExpiresAt: new Date(0) } });
    expect((await enroll(token)).statusCode).toBe(401);
    expect((await verify(token, secret)).statusCode).toBe(401);
  });
  it('rejects legacy and expired tokens', async () => {
    for (const expiresIn of [600, -1]) {
      const token = jwt.sign({ sub: admin.id, purpose: 'admin_mfa_enroll' }, process.env.JWT_ADMIN_SECRET!, { expiresIn });
      expect((await enroll(token)).statusCode).toBe(401);
    }
  });
  it('creates exactly one session for concurrent verification requests', async () => {
    const token = await login();
    const secret = (await enroll(token)).json().secret;
    const results = await Promise.all([verify(token, secret), verify(token, secret)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 401]);
    expect(await db.adminSession.count({ where: { adminUserId: admin.id } })).toBe(1);
  });
  it('a wrong code does not consume the enrollment attempt', async () => {
    const token = await login();
    const secret = (await enroll(token)).json().secret;
    const res = await app.inject({ method: 'POST', url: '/auth/admin/mfa/verify', headers: { authorization: `Bearer ${token}` }, payload: { totp: ['000000', '111111', '222222', '333333'].find(code => !authenticator.check(code, secret)) } });
    expect(res.statusCode).not.toBe(200);
    expect((await verify(token, secret)).statusCode).toBe(200);
  });
  it('rolls back factor activation when session creation fails', async () => {
    const token = await login();
    const secret = (await enroll(token)).json().secret;
    // A constraint in this disposable DB fails the actual session INSERT.
    await db.$executeRawUnsafe(`ALTER TABLE admin_session ADD CONSTRAINT test_mfa_session_failure CHECK (admin_user_id <> '${admin.id}'::uuid)`);
    try {
      expect((await verify(token, secret)).statusCode).toBe(500);
      expect((await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).mfaEnabled).toBe(false);
      expect(await db.adminSession.count({ where: { adminUserId: admin.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE admin_session DROP CONSTRAINT test_mfa_session_failure');
    }
    expect((await verify(token, secret)).statusCode).toBe(200);
  });
});
