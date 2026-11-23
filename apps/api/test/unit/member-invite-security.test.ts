import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandMemberRoutes } from '../../src/routes/brand-members.ts';

const f = vi.hoisted(() => ({ member: vi.fn(), user: vi.fn(), link: vi.fn(), members: vi.fn() }));
vi.mock('../../src/clients.ts', () => ({ getClients: () => ({
  prisma: { brandMember: { findUnique: f.member, findMany: f.members }, userProfile: { findMany: async () => [] } },
  supabaseAdmin: { auth: { admin: { getUserById: f.user, generateLink: f.link } } },
}) }));
// Route tests isolate the external auth guard; existing realm/role tests cover it.
vi.mock('../../src/middleware/guards.ts', () => {
  const guard = async (req: any) => { req.brand = { brandId: 'brand-a', userId: 'owner' }; req.brandRole = 'owner'; };
  return { requireBrand: guard, requireBrandSurface: () => guard };
});

const userId = '00000000-0000-4000-8000-000000000001';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  f.member.mockImplementation(async ({ where }) => where.brandId_userId.brandId === 'brand-a' ? { userId, status: 'active' } : null);
  f.members.mockResolvedValue([{ userId, status: 'active' }]);
  f.user.mockResolvedValue({ data: { user: { id: userId, email: 'member@example.test', email_confirmed_at: null, confirmed_at: null, last_sign_in_at: null } }, error: null });
  f.link.mockResolvedValue({ data: { properties: { action_link: 'https://auth.example.test/invite' } }, error: null });
  app = Fastify();
  await app.register(brandMemberRoutes);
});
afterEach(async () => { await app.close(); });
const reissue = () => app.inject({ method: 'POST', url: `/api/brand/members/${userId}/invite-link` });

describe('member invitation credentials', () => {
  it.each(['email_confirmed_at', 'confirmed_at', 'last_sign_in_at'])('rejects an established identity with %s', async (field) => {
    f.user.mockResolvedValue({ data: { user: { email: 'member@example.test', [field]: '2026-01-01T00:00:00Z' } }, error: null });
    expect((await reissue()).statusCode).toBe(409);
    expect(f.link).not.toHaveBeenCalled();
    expect((await app.inject('/api/brand/members')).json().members[0].pending).toBe(false);
  });
  it('rejects suspended members', async () => {
    f.member.mockResolvedValue({ userId, status: 'suspended' });
    expect((await reissue()).statusCode).toBe(409);
    expect(f.link).not.toHaveBeenCalled();
  });
  it('does not resolve Auth users outside the requesting brand', async () => {
    f.member.mockResolvedValue(null);
    expect((await reissue()).statusCode).toBe(404);
    expect(f.user).not.toHaveBeenCalled();
  });
  it('fails closed on Auth lookup errors even if a partial user is supplied', async () => {
    f.user.mockResolvedValue({ data: { user: { email: 'member@example.test' } }, error: new Error('upstream') });
    expect((await reissue()).statusCode).toBe(400);
    expect(f.link).not.toHaveBeenCalled();
    expect((await app.inject('/api/brand/members')).json().members[0].pending).toBe(false);
  });
  it('never substitutes recovery credentials when invite generation fails', async () => {
    f.link.mockResolvedValueOnce({ error: new Error('already confirmed') });
    const res = await reissue();
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('https://auth');
    expect(f.link.mock.calls.map(([arg]) => arg.type)).toEqual(['invite']);
  });
  it('reissues an invitation for an active unconfirmed invitee', async () => {
    const res = await reissue();
    expect(res.statusCode).toBe(200);
    expect(res.json().invite_link).toBe('https://auth.example.test/invite');
    expect((await app.inject('/api/brand/members')).json().members[0].pending).toBe(true);
  });
});
