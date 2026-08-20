import type { PrismaClient } from '@ruostack/db';
import { NotFound } from '../errors.ts';

/**
 * Marks the brand user's first-run welcome tour as finished.
 *
 * Idempotent BY DESIGN, not by accident: the Account screen lets a user replay
 * the tour, and dismissing a replay must not overwrite the original completion
 * time — that timestamp is the onboarding-completion metric.
 */
export async function completeOnboarding(prisma: PrismaClient, userId: string): Promise<Date> {
  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true },
  });
  if (!profile) throw NotFound('Account not found');
  if (profile.onboardingCompletedAt) return profile.onboardingCompletedAt;

  const updated = await prisma.userProfile.update({
    where: { id: userId },
    data: { onboardingCompletedAt: new Date() },
  });
  return updated.onboardingCompletedAt!;
}
