import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';
import { Loader2, type LucideIcon } from '../icons.js';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: LucideIcon;
}

const VARIANT = {
  // bg-accent-solid, not bg-accent: only the solid value carries a white
  // label at WCAG AA (4.91:1 vs 4.31:1).
  primary: 'bg-accent-solid text-white shadow-accent hover:brightness-110',
  ghost: 'border border-line text-content-muted hover:text-content hover:bg-surface-3',
  danger: 'border border-danger/50 text-danger hover:bg-danger-tint',
} as const;

const SIZE = {
  // min-h-11 is 44px, the mobile tap-target floor. Relaxed at md where a
  // pointer is assumed.
  sm: 'min-h-11 px-3.5 text-xs md:min-h-0 md:py-1.5',
  md: 'min-h-11 px-4 text-sm md:min-h-0 md:py-2',
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-pill font-semibold',
        'transition-[background,color,filter] duration-fast disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden className="h-4 w-4" />
      ) : null}
      {children}
    </button>
  );
});
