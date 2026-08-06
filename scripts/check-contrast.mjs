#!/usr/bin/env node
/**
 * Fails CI if any RUOStack design token pair drops below WCAG AA (4.5:1) in
 * either theme.
 *
 * Token values are READ FROM packages/ui/src/tokens.css rather than duplicated
 * here, so this gate can never disagree with what actually ships. Editing a hex
 * in tokens.css re-measures it on the next run.
 */
import { readFileSync } from 'node:fs';

const TOKENS_URL = new URL('../packages/ui/src/tokens.css', import.meta.url);
const css = readFileSync(TOKENS_URL, 'utf8');

/** Pull the `--name: #rrggbb;` declarations out of one selector's block. */
function block(selector, label) {
  const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`Could not find the ${label} (${selector}) block in tokens.css`);
  const out = {};
  for (const [, k, val] of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[k] = val;
  }
  return out;
}

const lum = (hex) => {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/../g)
    .map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const FOREGROUNDS = ['text', 'text-muted', 'text-faint', 'accent', 'success', 'warning', 'danger', 'info'];
const BACKGROUNDS = ['surface-1', 'canvas'];
const MIN = 4.5;

let failures = 0;

for (const [label, selector] of [['LIGHT', ':root'], ['DARK', '\\.dark']]) {
  const t = block(selector, label);
  console.log(`\n=== ${label} ===`);

  for (const bg of BACKGROUNDS) {
    for (const fg of FOREGROUNDS) {
      if (!t[fg]) throw new Error(`Missing --${fg} in the ${label} block`);
      if (!t[bg]) throw new Error(`Missing --${bg} in the ${label} block`);
      const r = ratio(t[fg], t[bg]);
      const ok = r >= MIN;
      if (!ok) failures++;
      console.log(
        `  ${`${fg} / ${bg}`.padEnd(24)} ${r.toFixed(2).padStart(5)}:1  ${ok ? 'PASS' : '** FAIL **'}`,
      );
    }
  }

  // The primary button always renders a white label on --accent-solid.
  if (!t['accent-solid']) throw new Error(`Missing --accent-solid in the ${label} block`);
  const btn = ratio('#FFFFFF', t['accent-solid']);
  const okBtn = btn >= MIN;
  if (!okBtn) failures++;
  console.log(
    `  ${'white / accent-solid'.padEnd(24)} ${btn.toFixed(2).padStart(5)}:1  ${okBtn ? 'PASS' : '** FAIL **'}`,
  );
}

console.log(
  failures === 0
    ? '\nAll token pairs meet WCAG AA.\n'
    : `\n${failures} pair(s) below ${MIN}:1 — fix packages/ui/src/tokens.css\n`,
);
process.exit(failures === 0 ? 0 : 1);
