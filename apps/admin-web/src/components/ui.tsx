import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between">
      <div>
        <h1 className="text-[23px] font-bold text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card p-3.5">
      <div className="text-[24px] font-extrabold text-text">{value}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`tab ${active === t.key ? 'tab-on' : ''}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="text-[15px] font-semibold text-text">{title}</div>
      {hint && <div className="max-w-md text-[13px] text-muted">{hint}</div>}
      {action}
    </div>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-bg2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[16px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-faint hover:text-text">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  in_stock: 'border-success/40 bg-success/10 text-success',
  soon: 'border-amber/40 bg-amber/10 text-amber',
  out_of_stock: 'border-danger/40 bg-danger/10 text-danger',
  active: 'border-success/40 bg-success/10 text-success',
  suspended: 'border-danger/40 bg-danger/10 text-danger',
};

export function StatusPill({ value }: { value: string }) {
  return <span className={`pill ${STATUS_STYLES[value] ?? ''}`}>{value.replace(/_/g, ' ')}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}
