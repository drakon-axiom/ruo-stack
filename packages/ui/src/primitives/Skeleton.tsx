import { cn } from '../lib/cn.js';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded bg-surface-3', className)} />;
}

/** Loading placeholder for a table body. Announces itself so screen-reader
 *  users get "Loading" rather than silence. */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
