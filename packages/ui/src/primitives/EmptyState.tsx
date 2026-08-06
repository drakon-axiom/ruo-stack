import type { ReactNode } from 'react';
import { Card } from './Card.js';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="text-lg font-semibold text-content">{title}</div>
      {hint && <div className="max-w-md text-sm text-content-muted">{hint}</div>}
      {action}
    </Card>
  );
}
