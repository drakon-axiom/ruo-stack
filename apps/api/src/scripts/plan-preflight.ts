// One-off read-only pre-flight for the admin-managed-plans work.
// Reports paid-subscriber counts so Task 8's `migration_required` guard and the
// Phase 1/Phase 2 split can be confirmed against reality rather than assumed.
import { getPrisma } from '@ruostack/db';

const prisma = getPrisma();

const rows = await prisma.subscriptionState.groupBy({ by: ['plan', 'status'], _count: true });
console.log('--- subscription_state by (plan, status) ---');
if (rows.length === 0) console.log('(no subscription_state rows at all)');
for (const r of rows) console.log(`  ${r.plan.padEnd(8)} ${r.status.padEnd(10)} ${r._count}`);

const paid = await prisma.subscriptionState.count({
  where: { plan: { in: ['pro', 'volume'] }, status: { in: ['active', 'past_due'] } },
});
const withStripeSub = await prisma.subscriptionState.count({ where: { stripeSubscriptionId: { not: null } } });
const brands = await prisma.brand.count();
const withCustomer = await prisma.brand.count({ where: { stripeCustomerId: { not: null } } });

console.log(`\nPAID (pro|volume AND active|past_due): ${paid}`);
console.log(`rows carrying a stripeSubscriptionId:  ${withStripeSub}`);
console.log(`brands total:                          ${brands}`);
console.log(`brands with a stripeCustomerId:        ${withCustomer}`);
await prisma.$disconnect();
