'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/adminApi';
import { StatusBadge, Pill, money } from '@/components/admin/ui';

export type Subscriber = {
  user_id: string;
  brand_name: string | null;
  full_name: string | null;
  role: string;
  subscription_status: string;
  subscription_bypass: boolean;
  onboarding_complete: boolean;
  created_at: string;
  email: string | null;
  wallet_balance: number;
  order_count: number;
  open_order_count: number;
};

type Filter = 'all' | 'active' | 'inactive' | 'bypass';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'bypass', label: 'Bypassed' },
];

function hasAccess(s: Subscriber) {
  return s.subscription_status === 'active' || s.subscription_bypass;
}

export function SellersTable({ subscribers }: { subscribers: Subscriber[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subscribers.filter((s) => {
      if (filter === 'active' && !hasAccess(s)) return false;
      if (filter === 'inactive' && hasAccess(s)) return false;
      if (filter === 'bypass' && !s.subscription_bypass) return false;
      if (!q) return true;
      return [s.brand_name, s.full_name, s.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [subscribers, query, filter]);

  async function toggleBypass(s: Subscriber) {
    setBusyId(s.user_id);
    setError(null);
    try {
      await adminApi('bypass_user', { user_id: s.user_id, bypass: !s.subscription_bypass });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search brand, name, or email…"
            className="w-full rounded-lg border bg-card py-2 pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                filter === f.key
                  ? 'bg-primary text-primary-foreground shadow-brand-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {subscribers.length}
        </span>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-card shadow-brand-sm">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Seller</th>
              <th className="px-4 py-3 font-medium">Subscription</th>
              <th className="px-4 py-3 text-right font-medium">Wallet</th>
              <th className="px-4 py-3 text-right font-medium">Orders</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 text-right font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.user_id} className="border-t transition-colors hover:bg-accent/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.brand_name || '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.email || s.full_name || 'no email'}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge kind="subscription" value={s.subscription_status} />
                    {s.subscription_bypass && <Pill tone="amber">Bypass</Pill>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(s.wallet_balance)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className="font-medium">{s.open_order_count}</span>
                  <span className="text-muted-foreground"> / {s.order_count}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(s.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleBypass(s)}
                    disabled={busyId === s.user_id}
                    title={
                      s.subscription_bypass
                        ? 'Revoke bypass (require an active subscription)'
                        : 'Grant access without a subscription'
                    }
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      s.subscription_bypass
                        ? 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40'
                        : 'hover:bg-accent'
                    }`}
                  >
                    {busyId === s.user_id
                      ? '…'
                      : s.subscription_bypass
                        ? 'Revoke bypass'
                        : 'Grant bypass'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No sellers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
