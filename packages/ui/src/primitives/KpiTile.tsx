import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from './Card.js';

const TONE = {
  default: 'text-content',
  warning: 'text-warning',
  accent: 'text-accent',
} as const;

export function KpiTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <Card className="p-4">
      <div className={cn('text-3xl font-extrabold tabular-nums tracking-tight', TONE[tone])}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-content-muted">{label}</div>
    </Card>
  );
}
