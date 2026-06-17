#!/usr/bin/env node
/**
 * CI guard (critical invariant #4 — Payments isolation).
 * The Stripe SDK may be imported in packages/payments ONLY. Any `stripe` import
 * (or require) anywhere else fails the build. Run: node scripts/check-stripe-imports.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ALLOWED_DIR = join(ROOT, 'packages', 'payments');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage']);
const CODE_EXT = /\.(?:m|c)?[jt]sx?$/;
// Matches:  import ... from 'stripe'  |  require('stripe')  |  import('stripe')
const STRIPE_IMPORT =
  /(?:from\s+['"]stripe['"])|(?:require\(\s*['"]stripe['"]\s*\))|(?:import\(\s*['"]stripe['"]\s*\))/;

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry)) out.push(full);
  }
}

const files = [];
walk(ROOT, files);

const violations = [];
for (const file of files) {
  if (file.startsWith(ALLOWED_DIR)) continue;
  const src = readFileSync(file, 'utf8');
  // Allow the guard script itself (it contains the literal string 'stripe').
  if (file === join(ROOT, 'scripts', 'check-stripe-imports.mjs')) continue;
  src.split('\n').forEach((line, i) => {
    if (STRIPE_IMPORT.test(line)) {
      violations.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error('✗ Payments isolation violated — `stripe` imported outside packages/payments:\n');
  for (const v of violations) console.error('  ' + v);
  console.error('\nCore/business code must call the PaymentsAdapter interface, never the Stripe SDK.');
  process.exit(1);
}
console.log('✓ Stripe SDK is imported only inside packages/payments.');
