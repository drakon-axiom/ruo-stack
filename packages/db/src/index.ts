import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single Prisma client. The API is the ONLY consumer of the database and
 * connects via the dedicated `prisma` role (bypassrls) over DATABASE_URL
 * (transaction pooler, 6543, pgbouncer=true). Authorization is enforced in
 * app code; RLS is defense-in-depth.
 */
let _prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}
