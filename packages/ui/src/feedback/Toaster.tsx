import { useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';

type Tone = 'success' | 'danger' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let push: ((t: Toast) => void) | null = null;
let nextId = 0;

/** Fire a toast from anywhere. No-ops if <Toaster /> is not mounted. */
export function toast(message: string, tone: Tone = 'info') {
  push?.({ id: nextId++, message, tone });
}

const TONE: Record<Tone, string> = {
  success: 'border-success/40 bg-success-tint text-success',
  danger: 'border-danger/40 bg-danger-tint text-danger',
  info: 'border-line bg-surface-2 text-content',
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    push = (t) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 4000);
    };
    return () => {
      push = null;
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      // bottom-24 on phones clears the fixed tab bar.
      className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:items-end"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={cn('pointer-events-auto rounded-[10px] border px-4 py-2.5 text-sm shadow-e2', TONE[t.tone])}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
