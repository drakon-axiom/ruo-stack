import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { getClients } from './clients.js';
import { startRateQuoteSweeper } from './services/rate-quote.js';
import { startReconciliationWorker } from './services/reconciliation.js';

async function main() {
  const cfg = loadConfig();
  const app = await buildApp();
  try {
    await app.listen({ port: cfg.API_PORT, host: cfg.API_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
  // Background: sweep expired rate quotes (their validity is short; this just
  // keeps the table from accumulating dead rows).
  startRateQuoteSweeper(
    getClients().prisma,
    cfg.RATE_QUOTE_CLEANUP_INTERVAL_SECONDS * 1000,
    (m) => app.log.info(m),
  );
  // Background: reconciliation worker — heal stuck webhooks + flag drift.
  startReconciliationWorker(
    getClients().prisma,
    cfg.RECONCILE_INTERVAL_SECONDS * 1000,
    (m) => app.log.info(m),
  );
}

main().catch((err) => {
  // Config validation failures land here — print and refuse to start.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
