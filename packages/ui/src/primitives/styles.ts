import { cn } from '../lib/cn.js';

/* Class builders for call sites that need the design-system look on a plain
 * element rather than a component — a native <select>, an <a> that must stay an
 * <a>, a wrapper <div> that already carries layout classes.
 *
 * These are NOT a compatibility shim. There is no global CSS being resurrected;
 * each call site imports from the design system, so a token change still
 * propagates. Prefer the real components (Button, Input, Card, Badge) when the
 * markup allows — they add loading state, aria-invalid wiring and Radix
 * semantics that a class string cannot. */

/** Elevation-1 surface. Matches <Card>. */
export function cardClass(className?: string): string {
  return cn(
    'rounded-card border border-line-subtle bg-surface-raised shadow-e1 dark:border-t-line',
    className,
  );
}

/** Text input / select / textarea. Matches <Input>. */
export function inputClass(className?: string): string {
  return cn(
    'min-h-11 w-full rounded-[10px] border border-line bg-surface-1 px-3 text-base text-content',
    'placeholder:text-content-faint transition-colors duration-fast',
    'focus:border-accent md:min-h-0 md:py-2 md:text-sm',
    className,
  );
}

/** Small-caps field label. Matches the label inside <Field>. */
export function labelClass(className?: string): string {
  return cn('text-2xs font-medium uppercase tracking-[0.1em] text-content-faint', className);
}

/** Filter chip. Matches a <Tabs> button; for a real tab strip use <Tabs>. */
export function chipClass(active: boolean, className?: string): string {
  return cn(
    'shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors duration-fast',
    active
      ? 'border-accent-solid bg-accent-solid text-white'
      : 'border-line bg-surface-3 text-content-muted hover:text-content',
    className,
  );
}

/** Neutral pill. Matches <Badge tone="neutral">; pass tone classes to override. */
export function pillClass(className?: string): string {
  return cn(
    'inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs font-medium',
    'border-line bg-surface-3 text-content-muted',
    className,
  );
}
