import { cn } from '../lib/cn.js';

/* The platform logo — the single definition for both apps.
 *
 * NOT a merchant's logo: this platform is white-label, and per-brand artwork
 * lives on `Brand.logoUrl` in Supabase Storage via
 * apps/api/src/routes/brand-branding.ts. This is the RUOStack mark, a
 * build-time asset.
 *
 * Artwork is the monochrome mark from the brand kit
 * (src/assets/ruostack-icon-monochrome.svg), inlined so it can use
 * `currentColor`: it inherits the surrounding text colour, so ONE definition
 * themes correctly on both canvases, with no light/dark variants and no
 * network request.
 *
 * The mark is 154x142 — NOT square. Size it by height and let the width
 * follow, or it letterboxes inside a square box.
 *
 * fillRule="evenodd" is load-bearing: each bar is one path whose subpaths are
 * the three vials. Under the default `nonzero` rule those subpaths fill solid
 * instead of knocking out, and the mark silently renders as three blank bars
 * with no vials — valid SVG, wrong logo. Covered by a test.
 */

/** The mark alone. Used by the collapsed rail and the mobile header. */
function MarkArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-2 -2 154 142"
      fill="currentColor"
      role="img"
      aria-label="RUOStack"
      className={cn('h-8 w-auto', className)}
    >
      <path fillRule="evenodd" d="M7,0 h136 a7,7 0 0 1 7,7 v24 a7,7 0 0 1 -7,7 h-136 a7,7 0 0 1 -7,-7 v-24 a7,7 0 0 1 7,-7 zM34.5,5 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM34,10 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 zM72.5,5 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM72,10 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 zM110.5,5 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM110,10 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 z" />
      <path fillRule="evenodd" d="M7,50 h136 a7,7 0 0 1 7,7 v24 a7,7 0 0 1 -7,7 h-136 a7,7 0 0 1 -7,-7 v-24 a7,7 0 0 1 7,-7 zM34.5,55 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM34,60 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 zM72.5,55 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM72,60 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 zM110.5,55 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM110,60 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 z" />
      <path fillRule="evenodd" d="M7,100 h136 a7,7 0 0 1 7,7 v24 a7,7 0 0 1 -7,7 h-136 a7,7 0 0 1 -7,-7 v-24 a7,7 0 0 1 7,-7 zM34.5,105 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM34,110 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 zM72.5,105 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM72,110 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 zM110.5,105 h5.0 a1.5,1.5 0 0 1 1.5,1.5 v1.0 a1.5,1.5 0 0 1 -1.5,1.5 h-5.0 a1.5,1.5 0 0 1 -1.5,-1.5 v-1.0 a1.5,1.5 0 0 1 1.5,-1.5 zM110,110 h6 a4,4 0 0 1 4,4 v15 a4,4 0 0 1 -4,4 h-6 a4,4 0 0 1 -4,-4 v-15 a4,4 0 0 1 4,-4 z" />
    </svg>
  );
}

/* The kit's lockup (ruostack-lockup-monochrome.svg) sets the wordmark as an
 * SVG <text> element in Arial rather than converting it to outlines. That
 * renders in whatever font the viewer happens to have, does not match the Inter
 * used everywhere else in this UI, and shifts between platforms. The lockup is
 * therefore composed here: the kit's mark plus the wordmark in the app's own
 * typeface. Swap to the kit lockup once its text is converted to paths. */
function WordmarkArt({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <MarkArt className="h-8 w-auto shrink-0" />
      <span className="text-lg font-bold tracking-tight text-content">RUOStack</span>
    </span>
  );
}

export interface LogoProps {
  /** `mark` is the glyph alone; `full` is the mark plus the wordmark. */
  variant?: 'mark' | 'full';
  className?: string;
}

export function Logo({ variant = 'mark', className }: LogoProps) {
  if (variant === 'full') return <WordmarkArt className={className} />;
  return <MarkArt className={className} />;
}
