import { cn } from '../lib/cn.js';

export interface TabDef<T extends string> {
  key: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div
      role="tablist"
      // Scroll rather than wrap: wrapping chips push the table down and cause
      // layout jumps as filters change on a phone.
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              'shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors duration-fast',
              on
                ? 'border-accent-solid bg-accent-solid text-white'
                : 'border-line bg-surface-3 text-content-muted hover:text-content',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
