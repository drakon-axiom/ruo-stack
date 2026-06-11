import { getPrisma } from '@ruostack/db';
import { loadConfig } from '../config.js';
import { hashPassword } from '../crypto.js';

/**
 * Bootstrap the first super_admin (option a) — solves the empty-admin-table
 * chicken-and-egg. MFA is left disabled so first login FORCES TOTP enrollment.
 * Idempotent: if the email already exists, does nothing.
 *
 * Env: SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD.
 */
async function main() {
  const cfg = loadConfig();
  if (!cfg.SEED_SUPERADMIN_EMAIL || !cfg.SEED_SUPERADMIN_PASSWORD) {
    throw new Error('Set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD before seeding');
  }
  const prisma = getPrisma();

  const existing = await prisma.adminUser.findUnique({ where: { email: cfg.SEED_SUPERADMIN_EMAIL } });
  if (existing) {
    console.log(`super_admin ${cfg.SEED_SUPERADMIN_EMAIL} already exists — nothing to do.`);
    return;
  }

  const admin = await prisma.adminUser.create({
    data: {
      email: cfg.SEED_SUPERADMIN_EMAIL,
      fullName: 'Super Admin',
      role: 'super_admin',
      passwordHash: await hashPassword(cfg.SEED_SUPERADMIN_PASSWORD),
      mfaEnabled: false, // first login forces TOTP enrollment
    },
  });
  console.log(`✓ Seeded super_admin ${admin.email} (${admin.id}). First login will force TOTP enrollment.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
