import type { ReactNode } from 'react';

/* ───────────────────────────────────────────────────────────────────────────
   Elevated admin primitives. Pure/presentational (no client hooks) so server
   components can render them directly. Built on the existing design tokens.
   ─────────────────────────────────────────────────────────────────────────── */

/** Page title block with optional description + right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Surface card with the design system's border + soft shadow. */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground shadow-brand-sm ${className}`}
    >
      {children}
    </div>
  );
}

const STAT_ACCENTS: Record<string, string> = {
  warm: 'var(--gradient-warm)',
  ocean: 'var(--gradient-ocean)',
  sunset: 'var(--gradient-sunset)',
};

/**
 * Headline metric. An optional `accent` paints a thin gradient rail down the
 * left edge so a row of stats reads as a set without shouting.
 */
export function StatCard({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: keyof typeof STAT_ACCENTS;
  icon?: ReactNode;
}) {
  return (
    <Card className="hover-lift relative overflow-hidden p-5">
      {accent && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: STAT_ACCENTS[accent] }}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/* ── Status pills ──────────────────────────────────────────────────────────── */

const PILL_BASE =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap';

const ORDER_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  pending: { label: 'Pending', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300', dot: 'bg-slate-400' },
  awaiting_funds: { label: 'Awaiting funds', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500' },
  processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', dot: 'bg-blue-500' },
  shipped: { label: 'Shipped', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', dot: 'bg-indigo-500' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  fulfilled: { label: 'Fulfilled', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400', dot: 'bg-zinc-400' },
  refunded: { label: 'Refunded', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', dot: 'bg-rose-500' },
};

const SUB_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  none: { label: 'No plan', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400', dot: 'bg-zinc-400' },
  trialing: { label: 'Trialing', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', dot: 'bg-blue-500' },
  active: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  past_due: { label: 'Past due', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500' },
  canceled: { label: 'Canceled', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', dot: 'bg-rose-500' },
};

export function StatusBadge({
  kind,
  value,
  withDot = true,
}: {
  kind: 'order' | 'subscription';
  value: string;
  withDot?: boolean;
}) {
  const map = kind === 'order' ? ORDER_STATUS : SUB_STATUS;
  const meta = map[value] ?? {
    label: value,
    cls: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
  };
  return (
    <span className={`${PILL_BASE} ${meta.cls}`}>
      {withDot && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta.label}
    </span>
  );
}

/** Neutral pill for ad-hoc labels (e.g. bypass, source). */
export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'primary' | 'emerald' | 'amber';
}) {
  const tones: Record<string, string> = {
    muted: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return <span className={`${PILL_BASE} ${tones[tone]}`}>{children}</span>;
}

/** Money formatter shared across admin tables. */
export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
