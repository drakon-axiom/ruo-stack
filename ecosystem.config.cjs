// PM2 process config for the RUOStack API.
//
//   pm2 start ecosystem.config.cjs                     # dev checkout
//   RUOSTACK_ENV=prod pm2 start ecosystem.config.cjs   # prod checkout
//   pm2 save                                           # persist across reboots
//
// Dev and prod are two checkouts of this repo (/apps/dev/ruo-stack and
// /apps/prod/ruo-stack) on the same box, because apps/api/src/config.ts loads
// .env from the repo root relative to its own source file -- one directory can
// only ever bind to one database.
//
// Runs the COMPILED api (apps/api/dist/server.js), never tsx watch: dev and
// prod must execute the same artifact from the same build.

const ENV = process.env.RUOSTACK_ENV || 'dev';

if (ENV !== 'dev' && ENV !== 'prod') {
  throw new Error(`RUOSTACK_ENV must be "dev" or "prod", got "${ENV}"`);
}

const API_PORT = ENV === 'prod' ? '3911' : '3901';

module.exports = {
  apps: [
    {
      name: `ruostack-api-${ENV}`,
      // cwd pinned to this file's directory so dotenv resolves the repo-root
      // .env no matter where pm2 was invoked from.
      cwd: __dirname,
      // TypeScript source, not a build artifact. Node strips types at load time
      // (>=22.18 / 24), and every workspace package this imports is consumed the
      // same way. Emitting to dist/ was the old shape and it could not work:
      // tsc compiled only apps/api's own sources, so the built server still
      // imported @ruostack/{payments,email,shared} as raw TS -- which tsx
      // resolved in dev and plain node could not, crashing on first boot.
      // Running from source keeps dev and prod byte-identical.
      script: 'apps/api/src/server.ts',
      // pm2 picks an interpreter from the file extension and maps .ts to bun,
      // which is not installed. Node runs this file directly -- it strips the
      // types itself -- so pin it rather than adding a transpiler.
      interpreter: 'node',
      // Single instance: the rate-quote sweeper, reconciliation, dunning, and
      // subscription-lapse workers all start unconditionally in
      // apps/api/src/server.ts, so a second instance doubles every sweep.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '500M',
      watch: false,
      // PM2 exports these before spawn and dotenv runs with override:false, so
      // they win over .env -- the port and loopback binding stay pinned even if
      // .env drifts. Only origin nginx reaches this port.
      env: {
        NODE_ENV: 'production',
        API_HOST: '127.0.0.1',
        API_PORT,
      },
      out_file: `/var/log/ruostack-${ENV}/out.log`,
      error_file: `/var/log/ruostack-${ENV}/error.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
