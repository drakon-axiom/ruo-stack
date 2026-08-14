import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { getClients } from './clients.ts';
import { warmJwks } from './auth/brand-token.ts';
import { startRateQuoteSweeper } from './services/rate-quote.ts';
import { startReconciliationWorker } from './services/reconciliation.ts';
import { startDunningWorker } from './services/dunning.ts';
import { startSubscriptionLapseWorker } from './services/subscription.ts';

async function main() {
  const cfg = loadConfig();
  const app = await buildApp();
  try {
    await app.listen({ port: cfg.API_PORT, host: cfg.API_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
  // Fetch the Supabase JWKS now so the first brand request does not pay for it
  // (~457ms, measured). Deliberately not awaited before listen(): the warm-up
  // never throws, and holding the port closed on a Supabase round-trip would
  // trade a slow first request for a slow boot.
  void warmJwks().then((ok) => {
    if (ok) app.log.info('jwks: key set warmed at boot');
    else app.log.warn('jwks: warm-up failed; first brand request will fetch it');
  });
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
  // Background: lapse sweep — suspend memberships whose paid-through date has
  // passed. Purely local, so it holds whatever collected the money (or didn't).
  startSubscriptionLapseWorker(
    getClients().prisma,
    cfg.DUNNING_SWEEP_INTERVAL_SECONDS * 1000,
    (m) => app.log.info(m),
  );
  // Background: dunning — notify on past-due, suspend after the grace window.
  const c = getClients();
  startDunningWorker(
    c.prisma,
    c.email,
    c.supabaseAdmin,
    cfg.DUNNING_GRACE_DAYS,
    cfg.DUNNING_SWEEP_INTERVAL_SECONDS * 1000,
    (m) => app.log.info(m),
  );
}

main().catch((err) => {
  // Config validation failures land here — print and refuse to start.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
