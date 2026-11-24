import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandMemberRoutes } from '../../src/routes/brand-members.ts';

const f = vi.hoisted(() => ({ member: vi.fn(), user: vi.fn(), link: vi.fn(), members: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/clients.ts', () => ({ getClients: () => ({
  prisma: { $transaction: f.transaction, brandMember: { findUnique: f.member, findMany: f.members }, userProfile: { findMany: async () => [] } },
  supabaseAdmin: { auth: { admin: { getUserById: f.user, generateLink: f.link, createUser: f.createUser, deleteUser: f.deleteUser } } },
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
  f.createUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  f.deleteUser.mockResolvedValue({ error: null });
  f.transaction.mockImplementation(async cb => cb({ $executeRaw: async () => 1, userProfile: { upsert: async () => ({}) }, brandMember: { findUnique: async () => ({ role: 'owner', status: 'active' }), create: async () => ({}) }, brandUserRole: { create: async () => ({}) }, auditLog: { create: async () => ({}) } }));
  f.link.mockResolvedValue({ data: { user: { id: userId }, properties: { action_link: 'https://auth.example.test/invite' } }, error: null });
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

const invite = () => app.inject({ method: 'POST', url: '/api/brand/members', payload: { email: 'member@example.test', full_name: 'Member', role: 'staff' } });
describe('initial invitation identity ownership', () => {
  it('rejects an existing Auth identity without minting a link or deleting it', async () => {
    f.createUser.mockResolvedValue({ data: { user: null }, error: new Error('existing identity') });
    expect((await invite()).statusCode).toBe(409);
    expect(f.link).not.toHaveBeenCalled();
    expect(f.deleteUser).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('creates a new unconfirmed identity before minting its invitation', async () => {
    const res = await invite();
    expect(res.statusCode).toBe(201);
    expect(f.createUser).toHaveBeenCalledWith({ email: 'member@example.test', email_confirm: false, user_metadata: { full_name: 'Member' } });
    expect(f.createUser.mock.invocationCallOrder[0]).toBeLessThan(f.link.mock.invocationCallOrder[0]!);
    expect(res.json().user_id).toBe(userId);
  });
  it('rejects a link for another identity and compensates only the newly-created user', async () => {
    f.link.mockResolvedValue({ data: { user: { id: 'other-user' }, properties: { action_link: 'https://auth.example.test/other' } }, error: null });
    const res = await invite();
    expect(res.statusCode).toBe(409);
    expect(res.body).not.toContain('https://auth');
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.deleteUser.mock.calls).toEqual([[userId]]);
  });
  it('does not return a reissued link if its identity differs from the requested member', async () => {
    f.link.mockResolvedValue({ data: { user: { id: 'other-user' }, properties: { action_link: 'https://auth.example.test/other' } }, error: null });
    expect((await reissue()).statusCode).toBe(400);
    expect(f.deleteUser).not.toHaveBeenCalled();
  });
  it('compensates a new identity when generating the link fails', async () => {
    f.link.mockResolvedValue({ data: {}, error: new Error('link failure') });
    expect((await invite()).statusCode).toBe(409);
    expect(f.deleteUser.mock.calls).toEqual([[userId]]);
  });
  it('compensates only the newly-created identity on database failure', async () => {
    f.transaction.mockRejectedValue(new Error('database internal detail'));
    const res = await invite();
    expect(res.statusCode).toBe(409);
    expect(res.body).not.toContain('database internal detail');
    expect(f.deleteUser.mock.calls).toEqual([[userId]]);
  });
});
