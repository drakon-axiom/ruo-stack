import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main() {
  const cfg = loadConfig();
  const app = await buildApp();
  try {
    await app.listen({ port: cfg.API_PORT, host: cfg.API_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  // Config validation failures land here — print and refuse to start.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
