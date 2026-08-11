import { PrismaClient } from '@ruostack/db';
import { deleteExpiredRateQuotes } from '../services/rate-quote.ts';

/**
 * One-shot expired-RateQuote cleanup, for an external scheduler (cron) when you'd
 * rather not rely on the in-process sweeper. The API also sweeps on its own
 * (RATE_QUOTE_CLEANUP_INTERVAL_SECONDS). Importing rate-quote → config loads the
 * root .env, so DATABASE_URL is available.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const n = await deleteExpiredRateQuotes(prisma);
    console.log(`[cleanup-rate-quotes] deleted ${n} expired rate quote(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
