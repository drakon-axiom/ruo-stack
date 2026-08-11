import type { FastifyInstance } from 'fastify';
import { AUDIT_ACTIONS, BRAND_MEMBER_ROLES, EmailSchema, wouldOrphanBrand } from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireBrand, requireBrandSurface } from '../middleware/guards.ts';
import { BadRequest, Conflict, NotFound } from '../errors.ts';

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
 * the underlying Supabase user has NO password until someone uses the link —
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

  /** Owner count for the brand — the last-owner guard's input. */
  const ownerCount = (brandId: string) => prisma.brandMember.count({ where: { brandId, role: 'owner', status: 'active' } });

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
          const { data } = await supabaseAdmin.auth.admin.getUserById(m.userId);
          email = data.user?.email ?? null;
          pending = !data.user?.last_sign_in_at;
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

    // `generateLink` creates the auth user and returns the action link in one
    // call. It fails when the email already exists anywhere in the pool — which
    // includes another brand's member, so the message stays deliberately vague.
    const link = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: body.email,
      options: { data: { full_name: body.full_name } },
    });
    if (link.error || !link.data.user) {
      throw Conflict('invite_failed', link.error?.message ?? 'Could not create an invite for that email');
    }
    const userId = link.data.user.id;

    try {
      await prisma.$transaction(async (tx) => {
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
    } catch (e) {
      // Same compensating-delete discipline as signup: no orphan auth users.
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
      throw Conflict('invite_failed', e instanceof Error ? e.message.slice(0, 160) : 'Could not create the invite');
    }

    return reply.code(201).send({
      user_id: userId,
      email: body.email,
      role: body.role,
      // The whole point: the owner delivers this themselves.
      invite_link: link.data.properties?.action_link ?? null,
    });
  });

  // Re-mint a link for someone who lost theirs. `invite` only works for a user
  // who has never been confirmed, so fall back to a recovery link.
  app.post('/api/brand/members/:userId/invite-link', { preHandler: requireBrandSurface('members') }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { brandId } = req.brand!;

    const member = await prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
    if (!member) throw NotFound('Member not found');

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData.user?.email;
    if (!email) throw BadRequest('no_email', 'That member has no email on file');

    let link = await supabaseAdmin.auth.admin.generateLink({ type: 'invite', email });
    if (link.error) link = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
    if (link.error) throw BadRequest('link_failed', link.error.message.slice(0, 160));

    return { user_id: userId, email, invite_link: link.data.properties?.action_link ?? null };
  });

  // Change a member's role. Demoting the last owner is refused.
  app.patch('/api/brand/members/:userId', { preHandler: requireBrandSurface('members') }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { role } = z.object({ role: z.enum(BRAND_MEMBER_ROLES) }).parse(req.body);
    const { brandId, userId: actorId } = req.brand!;

    const member = await prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
    if (!member) throw NotFound('Member not found');
    if (member.role === role) return { user_id: userId, role };

    if (wouldOrphanBrand({ ownerCount: await ownerCount(brandId), targetIsOwner: member.role === 'owner', losingOwner: role !== 'owner' })) {
      throw BadRequest('last_owner', 'A brand must keep at least one owner — promote someone else first');
    }

    const updated = await prisma.$transaction(async (tx) => {
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

    const member = await prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
    if (!member) throw NotFound('Member not found');
    if (wouldOrphanBrand({ ownerCount: await ownerCount(brandId), targetIsOwner: member.role === 'owner', losingOwner: true })) {
      throw BadRequest('last_owner', 'A brand must keep at least one owner');
    }

    await prisma.$transaction(async (tx) => {
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

    const member = await prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId } } });
    if (!member) throw NotFound('Member not found');
    if (member.status === 'active') return { user_id: userId, status: 'active' };

    await prisma.$transaction(async (tx) => {
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
