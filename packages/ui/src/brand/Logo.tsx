import { cn } from '../lib/cn.js';

/* The platform logo — the single definition for both apps.
 *
 * NOT to be confused with a merchant's own logo: this platform is white-label,
 * and per-brand artwork lives on `Brand.logoUrl` in Supabase Storage, uploaded
 * through apps/api/src/routes/brand-branding.ts and served at runtime. This is
 * the RUOStack mark, a build-time asset.
 *
 * The artwork is inline SVG using `currentColor` rather than an <img>: it
 * inherits the surrounding text colour, so one definition themes correctly on
 * both the dark canvas and the light one, costs no network request, and stays
 * crisp at any size.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INTERIM ARTWORK. The paths below are the placeholder "R" the UI shipped
 * with. To install the real logo, replace ONLY the two <path> elements:
 *   MarkArt     <- packages/ui/src/assets/logo-mark.svg
 *   WordmarkArt <- packages/ui/src/assets/logo-wordmark.svg
 * Strip any `fill="…"` / `stroke="…"` from the source so currentColor applies,
 * and keep each viewBox tight to the artwork so the sizing below holds.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Square mark. Used by the collapsed rail, the mobile header and the favicon. */
function MarkArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="RUOStack" className={className}>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M11 23V9h6.4a4.3 4.3 0 0 1 1.5 8.34L21.6 23h-3.3l-2.4-5.1H14V23h-3Zm3-7.6h3.2a1.9 1.9 0 0 0 0-3.8H14v3.8Z"
        className="fill-white dark:fill-canvas"
      />
    </svg>
  );
}

/** Mark + wordmark lockup. Used by the expanded sidebar and the auth screens. */
function WordmarkArt({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <MarkArt className="h-8 w-8 shrink-0" />
      <span className="text-lg font-bold tracking-tight text-content">RUOStack</span>
    </span>
  );
}

export interface LogoProps {
  /** `mark` is the square glyph alone; `full` is the mark plus the wordmark. */
  variant?: 'mark' | 'full';
  className?: string;
}

export function Logo({ variant = 'mark', className }: LogoProps) {
  if (variant === 'full') return <WordmarkArt className={className} />;
  return <MarkArt className={cn('h-8 w-8', className)} />;
}
