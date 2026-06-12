import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { AdminLoginSchema, AdminMfaVerifySchema } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { loadConfig } from '../config.js';
import { signAdminAccessToken } from '../auth/admin-jwt.js';
import { decryptSecret, encryptSecret, hashToken, randomToken, verifyPassword } from '../crypto.js';
import { BadRequest, Unauthorized } from '../errors.js';

const ENROLL_PURPOSE = 'admin_mfa_enroll';
const ENROLL_TTL = 600; // 10 min to complete first-login enrollment
const TOTP_ISSUER = 'RUOStack Admin';

interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Issue an AdminSession (revocable refresh) + a short-lived access token. */
async function issueSession(req: FastifyRequest, adminUserId: string, role: string): Promise<SessionTokens> {
  const { prisma } = getClients();
  const cfg = loadConfig();
  const refresh = randomToken(48);
  const session = await prisma.adminSession.create({
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

function signEnrollmentToken(adminUserId: string): string {
  const cfg = loadConfig();
  return jwt.sign({ sub: adminUserId, purpose: ENROLL_PURPOSE }, cfg.JWT_ADMIN_SECRET, {
    algorithm: 'HS256',
    expiresIn: ENROLL_TTL,
  });
}

function verifyEnrollmentToken(token: string): string {
  const cfg = loadConfig();
  try {
    const d = jwt.verify(token, cfg.JWT_ADMIN_SECRET, { algorithms: ['HS256'] });
    if (typeof d === 'string' || d['purpose'] !== ENROLL_PURPOSE || !d.sub) throw new Error('bad');
    return String(d.sub);
  } catch {
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
  app.post('/auth/admin/login', async (req, reply) => {
    const body = AdminLoginSchema.parse(req.body);
    const admin = await prisma.adminUser.findUnique({ where: { email: body.email } });

    // Uniform failure to avoid user enumeration.
    const okPassword = admin ? await verifyPassword(body.password, admin.passwordHash) : false;
    if (!admin || !okPassword) throw Unauthorized('Invalid credentials');
    if (admin.status !== 'active') throw Unauthorized('Account suspended');

    if (!admin.mfaEnabled) {
      // Force enrollment; no access token yet.
      return reply.code(200).send({
        mfa_enrollment_required: true,
        enrollment_token: signEnrollmentToken(admin.id),
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
    const adminId = verifyEnrollmentToken(enrollmentBearer(req));
    const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw Unauthorized('Unknown admin');

    const secret = authenticator.generateSecret();
    // Store the (encrypted) pending secret; mfaEnabled flips to true only on verify.
    await prisma.adminUser.update({
      where: { id: adminId },
      data: { mfaSecret: encryptSecret(secret, cfg.MFA_ENCRYPTION_KEY), mfaEnabled: false },
    });
    const otpauthUri = authenticator.keyuri(admin.email, TOTP_ISSUER, secret);
    return { secret, otpauth_uri: otpauthUri };
  });

  // ── MFA verify (confirms enrollment, completes login) ─────────────────────
  app.post('/auth/admin/mfa/verify', async (req, reply) => {
    const adminId = verifyEnrollmentToken(enrollmentBearer(req));
    const { totp } = AdminMfaVerifySchema.parse(req.body);
    const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin?.mfaSecret) throw BadRequest('no_pending_enrollment', 'Call /mfa/enroll first');

    const secret = decryptSecret(admin.mfaSecret, cfg.MFA_ENCRYPTION_KEY);
    if (!authenticator.check(totp, secret)) throw Unauthorized('Invalid TOTP');

    await prisma.adminUser.update({
      where: { id: adminId },
      data: { mfaEnabled: true, lastLoginAt: new Date() },
    });
    const tokens = await issueSession(req, admin.id, admin.role);
    return reply.send(tokens);
  });

  // ── Refresh (rotate session) ──────────────────────────────────────────────
  app.post('/auth/admin/refresh', async (req, reply) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    if (!refresh_token) throw Unauthorized('Missing refresh token');
    const session = await prisma.adminSession.findUnique({
      where: { refreshTokenHash: hashToken(refresh_token) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw Unauthorized('Invalid refresh token');
    }
    const admin = await prisma.adminUser.findUnique({ where: { id: session.adminUserId } });
    if (!admin || admin.status !== 'active') throw Unauthorized('Admin inactive');

    // Rotate: revoke the old session, issue a new one.
    await prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const tokens = await issueSession(req, admin.id, admin.role);
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
