import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-3 text-content-muted',
  accent: 'border-accent/40 bg-accent-tint text-accent',
  success: 'border-success/40 bg-success-tint text-success',
  warning: 'border-warning/40 bg-warning-tint text-warning',
  danger: 'border-danger/40 bg-danger-tint text-danger',
  info: 'border-info/40 bg-info-tint text-info',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
