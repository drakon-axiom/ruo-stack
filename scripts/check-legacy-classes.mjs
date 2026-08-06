#!/usr/bin/env node
/**
 * Fails if any screen still references a class from the deleted
 * `@layer components` blocks. Those classes no longer exist, so a reference is
 * an element rendering with no styling at all — invisible to typecheck and to
 * the build.
 *
 * Splits className string literals into whitespace-delimited tokens and matches
 * exactly, so `bg-surface-3` is not mistaken for the old `surface` class.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY = new Set([
  'btn',
  'btn-ghost',
  'btn-danger',
  'card',
  'surface',
  'input',
  'l-input',
  'app-input',
  'label',
  'pill',
  'tab',
  'tab-on',
]);

const ROOTS = ['apps/brand-web/src', 'apps/admin-web/src'];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.tsx')) yield full;
  }
}

let hits = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      // Only string-literal className values; template literals with
      // interpolation are checked for their static parts too.
      for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const value = m[1] ?? m[2] ?? '';
        for (const token of value.split(/[\s${}]+/)) {
          if (LEGACY.has(token)) {
            console.log(`${file}:${i + 1}  ${token}`);
            hits++;
          }
        }
      }
    });
  }
}

console.log(
  hits === 0
    ? '\nNo legacy component classes remain.\n'
    : `\n${hits} legacy class reference(s) still present — these render unstyled.\n`,
);
process.exit(hits === 0 ? 0 : 1);
