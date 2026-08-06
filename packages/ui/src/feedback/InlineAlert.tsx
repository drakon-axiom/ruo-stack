import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

const TONE = {
  accent: 'border-accent/40 bg-accent-tint text-accent',
  success: 'border-success/40 bg-success-tint text-success',
  warning: 'border-warning/40 bg-warning-tint text-warning',
  danger: 'border-danger/40 bg-danger-tint text-danger',
  info: 'border-info/40 bg-info-tint text-info',
} as const;

export function InlineAlert({
  tone = 'info',
  action,
  children,
}: {
  tone?: keyof typeof TONE;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-[10px] border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        TONE[tone],
      )}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
