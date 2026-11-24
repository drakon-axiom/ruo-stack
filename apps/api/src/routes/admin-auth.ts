import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AdminUser, Prisma, PrismaClient } from '@ruostack/db';
import { authenticator } from 'otplib';
import { AdminLoginSchema, AdminMfaVerifySchema } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { loadConfig } from '../config.ts';
import { signAdminAccessToken } from '../auth/admin-jwt.ts';
import { decryptSecret, encryptSecret, hashToken, randomToken, verifyPassword } from '../crypto.ts';
import { BadRequest, Unauthorized } from '../errors.ts';

const ENROLL_PURPOSE = 'admin_mfa_enroll';
const ENROLL_TTL = 600; // 10 min to complete first-login enrollment
const TOTP_ISSUER = 'RUOStack Admin';

// Accept the adjacent 30s steps (±1) so a small clock skew between the server and
// the authenticator app — or entering the code near a step boundary — doesn't
// reject an otherwise-valid code. otplib defaults to window 0 (no tolerance).
authenticator.options = { window: 1 };

interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Issue an AdminSession (revocable refresh) + a short-lived access token. */
async function issueSession(req: FastifyRequest, adminUserId: string, role: string, db: PrismaClient | Prisma.TransactionClient = getClients().prisma): Promise<SessionTokens> {
  const cfg = loadConfig();
  const refresh = randomToken(48);
  const session = await db.adminSession.create({
    data: {
      adminUserId,
      refreshTokenHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + cfg.JWT_ADMIN_REFRESH_TTL * 1000),
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
    },
  });
  const access = signAdminAccessToken({ sub: adminUserId, role: role as never, sid: session.id });
  return { access_token: access, refresh_token: refresh, expires_in: cfg.JWT_ADMIN_ACCESS_TTL };
}

function signEnrollmentToken(adminUserId: string, enrollmentId: string): string {
  const cfg = loadConfig();
  return jwt.sign({ sub: adminUserId, purpose: ENROLL_PURPOSE, jti: enrollmentId }, cfg.JWT_ADMIN_SECRET, {
    algorithm: 'HS256',
    expiresIn: ENROLL_TTL,
  });
}

function verifyEnrollmentToken(token: string): { adminId: string; enrollmentId: string } {
  const cfg = loadConfig();
  try {
    const d = jwt.verify(token, cfg.JWT_ADMIN_SECRET, { algorithms: ['HS256'] });
    if (typeof d === 'string' || d['purpose'] !== ENROLL_PURPOSE || !d.sub || typeof d.jti !== 'string' || !d.jti) throw new Error('bad');
    return { adminId: String(d.sub), enrollmentId: d.jti };
  } catch {
    throw Unauthorized('Invalid or expired enrollment token');
  }
}

// Row locks serialize login enrollment replacement, enroll, verify, and admin updates.
async function lockedAdmin(tx: Prisma.TransactionClient, id: string): Promise<AdminUser> {
  await tx.$queryRaw`SELECT id FROM admin_user WHERE id = ${id}::uuid FOR UPDATE`;
  const admin = await tx.adminUser.findUnique({ where: { id } });
  if (!admin || admin.status !== 'active') throw Unauthorized('Admin inactive');
  return admin;
}

function assertPending(admin: AdminUser, enrollmentId: string): void {
  if (admin.mfaEnabled || admin.mfaEnrollmentHash !== hashToken(enrollmentId) ||
      !admin.mfaEnrollmentExpiresAt || admin.mfaEnrollmentExpiresAt.getTime() <= Date.now()) {
    throw Unauthorized('Invalid or expired enrollment token');
  }
}

function enrollmentBearer(req: FastifyRequest): string {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw Unauthorized('Missing enrollment token');
  return h.slice(7).trim();
}

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();
  const cfg = loadConfig();

  // ── Login ─────────────────────────────────────────────────────────────────
  // Password → TOTP required → access + refresh. Login CANNOT complete without a
  // verified TOTP factor (critical invariant #8). A seeded super_admin with MFA
  // not yet enabled is forced into enrollment before any access token is issued.
  app.post('/auth/admin/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = AdminLoginSchema.parse(req.body);
    const admin = await prisma.adminUser.findUnique({ where: { email: body.email } });

    // Uniform failure to avoid user enumeration.
    const okPassword = admin ? await verifyPassword(body.password, admin.passwordHash) : false;
    if (!admin || !okPassword) throw Unauthorized('Invalid credentials');
    if (admin.status !== 'active') throw Unauthorized('Account suspended');

    if (!admin.mfaEnabled) {
      // Password was verified above; recheck mutable state under the same lock
      // used by enroll/verify so a delayed login cannot reset an enabled factor.
      const enrollmentId = randomToken(32);
      await prisma.$transaction(async (tx) => {
        const current = await lockedAdmin(tx, admin.id);
        if (current.mfaEnabled || current.passwordHash !== admin.passwordHash) {
          throw Unauthorized('Account changed; sign in again');
        }
        await tx.adminUser.update({ where: { id: admin.id }, data: {
          mfaEnrollmentHash: hashToken(enrollmentId),
          mfaEnrollmentExpiresAt: new Date(Date.now() + ENROLL_TTL * 1000),
          mfaPendingSecret: null,
        } });
      });
      return reply.code(200).send({
        mfa_enrollment_required: true,
        enrollment_token: signEnrollmentToken(admin.id, enrollmentId),
      });
    }

    // Password is valid but no code supplied yet → tell the client to prompt for
    // the TOTP code (a 200, not a 401, so the UI can advance to the code step).
    if (!body.totp) return reply.code(200).send({ mfa_required: true });
    if (!admin.mfaSecret) throw Unauthorized('MFA misconfigured');
    const secret = decryptSecret(admin.mfaSecret, cfg.MFA_ENCRYPTION_KEY);
    if (!authenticator.check(body.totp, secret)) throw Unauthorized('Invalid TOTP');

    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const tokens = await issueSession(req, admin.id, admin.role);
    return reply.send(tokens);
  });

  // ── MFA enroll (first login, enrollment token) ────────────────────────────
  app.post('/auth/admin/mfa/enroll', async (req) => {
    const { adminId, enrollmentId } = verifyEnrollmentToken(enrollmentBearer(req));
    return prisma.$transaction(async (tx) => {
      const admin = await lockedAdmin(tx, adminId);
      assertPending(admin, enrollmentId);
      const secret = admin.mfaPendingSecret
        ? decryptSecret(admin.mfaPendingSecret, cfg.MFA_ENCRYPTION_KEY)
        : authenticator.generateSecret();
      if (!admin.mfaPendingSecret) {
        await tx.adminUser.update({ where: { id: adminId }, data: {
          mfaPendingSecret: encryptSecret(secret, cfg.MFA_ENCRYPTION_KEY),
        } });
      }
      return { secret, otpauth_uri: authenticator.keyuri(admin.email, TOTP_ISSUER, secret) };
    });
  });

  // Consume enrollment, activate the factor, and create the session together.
  app.post('/auth/admin/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { adminId, enrollmentId } = verifyEnrollmentToken(enrollmentBearer(req));
    const { totp } = AdminMfaVerifySchema.parse(req.body);
    const tokens = await prisma.$transaction(async (tx) => {
      const admin = await lockedAdmin(tx, adminId);
      assertPending(admin, enrollmentId);
      if (!admin.mfaPendingSecret) throw BadRequest('no_pending_enrollment', 'Call /mfa/enroll first');
      const secret = decryptSecret(admin.mfaPendingSecret, cfg.MFA_ENCRYPTION_KEY);
      if (!authenticator.check(totp, secret)) throw Unauthorized('Invalid TOTP');
      await tx.adminUser.update({ where: { id: adminId }, data: {
        mfaEnabled: true,
        mfaSecret: admin.mfaPendingSecret,
        mfaPendingSecret: null,
        mfaEnrollmentHash: null,
        mfaEnrollmentExpiresAt: null,
        lastLoginAt: new Date(),
      } });
      return issueSession(req, admin.id, admin.role, tx);
    });
    return reply.send(tokens);
  });

  // ── Refresh (rotate session) ──────────────────────────────────────────────
  app.post('/auth/admin/refresh', async (req, reply) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: unknown };
    if (typeof refresh_token !== 'string' || !refresh_token) throw Unauthorized('Missing refresh token');
    const session = await prisma.adminSession.findUnique({
      where: { refreshTokenHash: hashToken(refresh_token) },
    });
    if (!session) throw Unauthorized('Invalid refresh token');
    const tokens = await prisma.$transaction(async (tx) => {
      // Match suspension's admin -> session lock order. A stale active-admin
      // read must not issue a fresh session after suspension revoked the old one.
      const admin = await lockedAdmin(tx, session.adminUserId);
      const consumed = await tx.adminSession.updateMany({
        where: { id: session.id, adminUserId: admin.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (consumed.count !== 1) throw Unauthorized('Invalid refresh token');
      return issueSession(req, admin.id, admin.role, tx);
    });
    return reply.send(tokens);
  });

  // ── Logout (revoke the presented session) ─────────────────────────────────
  app.post('/auth/admin/logout', async (req, reply) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    if (refresh_token) {
      await prisma.adminSession.updateMany({
        where: { refreshTokenHash: hashToken(refresh_token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return reply.send({ ok: true });
  });
}
