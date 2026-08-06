import { cn } from '../lib/cn.js';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  // bg-accent-solid, not bg-accent: only the solid value carries a white
  // label at WCAG AA (4.91:1 vs 4.31:1).
  primary: 'bg-accent-solid text-white shadow-accent hover:brightness-110',
  ghost: 'border border-line text-content-muted hover:text-content hover:bg-surface-3',
  danger: 'border border-danger/50 text-danger hover:bg-danger-tint',
};

const SIZE: Record<ButtonSize, string> = {
  // min-h-11 is 44px, the mobile tap-target floor. Relaxed at md where a
  // pointer is assumed.
  sm: 'min-h-11 px-3.5 text-xs md:min-h-0 md:py-1.5',
  md: 'min-h-11 px-4 text-sm md:min-h-0 md:py-2',
};

/** Shared by Button and LinkButton so the two can never drift apart. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-pill font-semibold',
    'transition-[background,color,filter] duration-fast disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
