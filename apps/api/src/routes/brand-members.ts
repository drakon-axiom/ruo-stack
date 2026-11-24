import type { Prisma } from '@ruostack/db';
import type { FastifyInstance } from 'fastify';
import { AUDIT_ACTIONS, BRAND_MEMBER_ROLES, EmailSchema, wouldOrphanBrand } from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireBrand, requireBrandSurface } from '../middleware/guards.ts';
import { BadRequest, Conflict, Forbidden, NotFound } from '../errors.ts';

/**
 * Brand team management (architecture §3.1 — "invite-staff UI lands later
 * without a migration"). The schema was built for this from day one; these are
 * the endpoints it was waiting for.
 *
 * INVITES ARE LINK-BASED, deliberately. Brand auth mail is Supabase's, and no
 * transactional SMTP is configured (see the note in the signup handler), so an
 * emailed invite would dead-end. Instead we mint a Supabase action link and hand
 * it back to the owner to deliver however they like. When SMTP lands this can
 * switch to `inviteUserByEmail` with no change to the data model.
 *
 * The invited member is created ACTIVE, which looks surprising until you follow
 * the token hook: it injects brand claims only for an `active` member, so an
 * `invited` row would mint claim-less tokens and lock the new user out of the
 * very endpoint they'd need to accept with. Creating them active is safe because
 * the underlying Supabase user has no known password before the invite is accepted —
 * membership grants nothing to anyone who can't sign in. "Pending" is therefore
 * derived from Supabase's `last_sign_in_at`, not stored.
 */
const InviteSchema = z.object({
  email: EmailSchema,
  full_name: z.string().min(1).max(120),
  role: z.enum(BRAND_MEMBER_ROLES).default('staff'),
});

export async function brandMemberRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, supabaseAdmin } = getClients();

  // Namespace 2 serializes membership writers, independently of wallet/ledger locks.
  // Recheck the actor after waiting: the request guard may predate a revocation.
  const asOwner = <T>(brandId: string, actorId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${brandId}), 2)`;
      const actor = await tx.brandMember.findUnique({ where: { brandId_userId: { brandId, userId: actorId } } });
      if (actor?.status !== 'active' || actor.role !== 'owner') throw Forbidden('Only an active brand owner can do that');
      return action(tx);
    });

  // Any active member can SEE the team; only an owner can change it.
  app.get('/api/brand/members', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const members = await prisma.brandMember.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' } });
    const profiles = await prisma.userProfile.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(profiles.map((p) => [p.id, p.fullName]));

    // Email + "have they ever signed in" live in Supabase Auth, not our tables.
    const enriched = await Promise.all(
      members.map(async (m) => {
        let email: string | null = null;
        let pending = false;
        try {
          const { data, error } = await supabaseAdmin.auth.admin.getUserById(m.userId);
          if (!error && data.user) {
            email = data.user.email ?? null;
            pending = !data.user.email_confirmed_at && !data.user.confirmed_at && !data.user.last_sign_in_at;
          }
        } catch {
          // A lookup failure must not blank the whole team list.
        }
        return {
          user_id: m.userId,
          full_name: nameById.get(m.userId) ?? null,
          email,
          role: m.role,
          status: m.status,
          pending,
          invited_at: m.invitedAt,
          created_at: m.createdAt,
          is_you: m.userId === req.brand!.userId,
        };
      }),
    );
    return { members: enriched, your_role: req.brandRole };
  });

  // Invite — mints the Supabase user + action link, then the brand-side rows.
  app.post('/api/brand/members', { preHandler: requireBrandSurface('members'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = InviteSchema.parse(req.body);
    const { brandId, userId: actorId } = req.brand!;

    // Reserve a NEW identity first. generateLink(invite) can return an existing
    // unconfirmed user, so it cannot establish ownership for creation/cleanup.
    const created = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      email_confirm: false,
      user_metadata: { full_name: body.full_name },
    });
    if (created.error || !created.data.user) {
      throw Conflict('invite_failed', 'Could not create an invite for that email');
    }
    const userId = created.data.user.id;
    let inviteLink: string;
    try {
      const link = await supabaseAdmin.auth.admin.generateLink({ type: 'invite', email: body.email });
      if (link.error || link.data.user?.id !== userId || !link.data.properties?.action_link) {
        throw new Error('Could not create the invitation');
      }
      inviteLink = link.data.properties.action_link;
      await asOwner(brandId, actorId, async (tx) => {
        await tx.userProfile.upsert({
          where: { id: userId },
          create: { id: userId, fullName: body.full_name },
          update: { fullName: body.full_name },
        });
        await tx.brandMember.create({
          data: { brandId, userId, role: body.role, status: 'active', invitedAt: new Date() },
        });
        await tx.brandUserRole.create({ data: { userId, brandId, realm: 'brand' } });
        await writeAudit(tx, {
          actorType: 'brand',
          actorId,
          action: AUDIT_ACTIONS.brandMemberInvited,
          targetType: 'brand_member',
          targetId: userId,
          after: { email: body.email, role: body.role },
          ip: req.ip,
        });
      });
    } catch {
      // Only the identity this request successfully created belongs to us.
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
      throw Conflict('invite_failed', 'Could not create the invite');
    }

    return reply.code(201).send({
      user_id: userId,
      email: body.email,
      role: body.role,
      // The whole point: the owner delivers this themselves.
      invite_link: inviteLink,
    });
  });

  // Reissue only an unconsumed invitation. Recovery credentials belong to the
  // account holder and must never be returned to a team administrator.
  app.post('/api/brand/members/:userId/invite-link', { preHandler: requireBrandSurface('members') }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { brandId } = req.brand!;

    const member = await prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
    if (!member) throw NotFound('Member not found');

    if (member.status !== 'active') throw Conflict('invite_not_pending', 'Only active pending invitations can be reissued');

    const { data: userData, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !userData.user) throw BadRequest('link_failed', 'Could not verify the pending invitation');
    if (userData.user.email_confirmed_at || userData.user.confirmed_at || userData.user.last_sign_in_at) {
      throw Conflict('invite_not_pending', 'This member must use the self-service password reset');
    }
    const email = userData.user.email;
    if (!email) throw BadRequest('no_email', 'That member has no email on file');

    const link = await supabaseAdmin.auth.admin.generateLink({ type: 'invite', email });
    if (link.error || link.data.user?.id !== userId || !link.data.properties?.action_link) {
      throw BadRequest('link_failed', 'Could not reissue the invitation');
    }

    return { user_id: userId, email, invite_link: link.data.properties?.action_link ?? null };
  });

  // Change a member's role. Demoting the last owner is refused.
  app.patch('/api/brand/members/:userId', { preHandler: requireBrandSurface('members') }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { role } = z.object({ role: z.enum(BRAND_MEMBER_ROLES) }).parse(req.body);
    const { brandId, userId: actorId } = req.brand!;

    const updated = await asOwner(brandId, actorId, async (tx) => {
      const member = await tx.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
      if (!member) throw NotFound('Member not found');
      if (member.role === role) return member;

      if (wouldOrphanBrand({ ownerCount: await tx.brandMember.count({ where: { brandId, role: 'owner', status: 'active' } }), targetIsOwner: member.role === 'owner' && member.status === 'active', losingOwner: role !== 'owner' })) {
        throw BadRequest('last_owner', 'A brand must keep at least one owner — promote someone else first');
      }

      const m = await tx.brandMember.update({ where: { brandId_userId: { brandId, userId } }, data: { role } });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId,
        action: AUDIT_ACTIONS.brandMemberRoleChanged,
        targetType: 'brand_member',
        targetId: userId,
        before: { role: member.role },
        after: { role },
        ip: req.ip,
      });
      return m;
    });
    return { user_id: userId, role: updated.role };
  });

  /**
   * Revoke access. Suspends rather than deletes: the membership row is the
   * referent for audit entries, and `requireBrand` already refuses a non-active
   * member on every request, so revocation is immediate rather than waiting for
   * the ~1h token to expire.
   */
  app.delete('/api/brand/members/:userId', { preHandler: requireBrandSurface('members') }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { brandId, userId: actorId } = req.brand!;

    if (userId === actorId) throw BadRequest('self_removal', 'You cannot remove your own access');

    await asOwner(brandId, actorId, async (tx) => {
      const member = await tx.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
      if (!member) throw NotFound('Member not found');
      if (wouldOrphanBrand({ ownerCount: await tx.brandMember.count({ where: { brandId, role: 'owner', status: 'active' } }), targetIsOwner: member.role === 'owner' && member.status === 'active', losingOwner: true })) {
        throw BadRequest('last_owner', 'A brand must keep at least one owner');
      }

      await tx.brandMember.update({ where: { brandId_userId: { brandId, userId } }, data: { status: 'suspended' } });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId,
        action: AUDIT_ACTIONS.brandMemberRemoved,
        targetType: 'brand_member',
        targetId: userId,
        before: { status: member.status, role: member.role },
        after: { status: 'suspended' },
        ip: req.ip,
      });
    });
    return { user_id: userId, status: 'suspended' };
  });

  // Restore a suspended member.
  app.post('/api/brand/members/:userId/reactivate', { preHandler: requireBrandSurface('members') }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { brandId, userId: actorId } = req.brand!;

    await asOwner(brandId, actorId, async (tx) => {
      const member = await tx.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
      if (!member) throw NotFound('Member not found');
      if (member.status === 'active') return;

      await tx.brandMember.update({ where: { brandId_userId: { brandId, userId } }, data: { status: 'active' } });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId,
        action: AUDIT_ACTIONS.brandMemberReactivated,
        targetType: 'brand_member',
        targetId: userId,
        before: { status: member.status },
        after: { status: 'active' },
        ip: req.ip,
      });
    });
    return { user_id: userId, status: 'active' };
  });
}
