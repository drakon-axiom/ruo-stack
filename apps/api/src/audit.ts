import { Prisma, type PrismaClient } from '@ruostack/db';
import type { AuditEntryInput } from '@ruostack/shared';

/**
 * Write one AuditLog row. The table is append-only (DB trigger raises on
 * UPDATE/DELETE even for the service role); this is the only write path.
 * Call inside the same transaction as the mutation it records where possible.
 *
 * `before`/`after` are stored as JSON snapshots. Never throws away the audit:
 * if auditing fails, the surrounding mutation should fail too.
 */
export async function writeAudit(
  db: Pick<PrismaClient, 'auditLog'>,
  entry: AuditEntryInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: entry.before == null ? Prisma.JsonNull : (entry.before as Prisma.InputJsonValue),
      after: entry.after == null ? Prisma.JsonNull : (entry.after as Prisma.InputJsonValue),
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
    },
  });
}

/** Strip volatile/internal fields before snapshotting into the audit log. */
export function auditSnapshot<T extends Record<string, unknown>>(row: T): Partial<T> {
  const { ...rest } = row;
  return rest;
}
