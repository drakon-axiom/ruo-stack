'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/adminApi';

export type Alert = {
  id: string;
  category: string;
  created_at: string;
  details: Record<string, unknown> | null;
  order_id: string | null;
  user_id: string | null;
};

const CATEGORY_TONE: Record<string, string> = {
  unsupported_product: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  sync_failure: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  stuck_awaiting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  missing_deduction: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

export function AlertsList({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await adminApi('resolve_alert', { alert_id: id });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-12 text-center shadow-brand-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-sm font-medium">All clear</p>
        <p className="text-xs text-muted-foreground">No unresolved monitor alerts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}
      <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-brand-sm">
        {alerts.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    CATEGORY_TONE[a.category] ?? 'bg-muted text-muted-foreground'
                  }`}
                >
                  {a.category.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              {a.details && (
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {JSON.stringify(a.details)}
                </p>
              )}
            </div>
            <button
              onClick={() => resolve(a.id)}
              disabled={busyId === a.id}
              className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              {busyId === a.id ? '…' : 'Resolve'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
