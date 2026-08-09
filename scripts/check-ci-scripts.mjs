#!/usr/bin/env node
/**
 * Fails if the CI workflow invokes a root pnpm script that does not exist.
 *
 * Written after the Responsive regression job spent two merged PRs red because
 * the workflow ran `pnpm test:e2e` and that script had never actually landed in
 * package.json. Nothing local catches this: the suite was being run directly
 * with `npx playwright test`, so the missing alias only showed up in CI, at the
 * end of a job, as a bare "Command not found".
 */
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));

// `pnpm <name>` where <name> is a bare script alias — skip pnpm's own
// subcommands and anything flag-driven (install, exec, --filter, -r …).
const BUILTIN = new Set(['install', 'exec', 'run', 'add', 'test', 'dlx', 'why', 'store']);
const referenced = new Set();

for (const line of workflow.split('\n')) {
  for (const m of line.matchAll(/\bpnpm\s+([a-z][a-z0-9:_-]*)/g)) {
    const name = m[1];
    if (BUILTIN.has(name) || name.startsWith('-')) continue;
    referenced.add(name);
  }
}

const missing = [...referenced].filter((n) => !scripts.has(n)).sort();

for (const name of [...referenced].sort()) {
  console.log(`  ${scripts.has(name) ? 'ok  ' : 'MISS'}  pnpm ${name}`);
}

if (missing.length) {
  console.log(
    `\n${missing.length} script(s) referenced by ci.yml are not defined in package.json: ${missing.join(', ')}\n`,
  );
  process.exit(1);
}
console.log('\nEvery script ci.yml invokes exists.\n');
