import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * Top-bar notifications bell. Shows the unread count and a panel of the most
 * recent broadcasts; the full history lives at /app/notifications.
 *
 * Opening the panel does NOT mark anything read — reading is an explicit act
 * (click an item, or "Mark all read"), so a glance at the badge can't silently
 * clear something the brand never actually looked at.
 */
export interface Notification {
  id: string;
  type: 'announcement' | 'restock' | 'maintenance';
  title: string;
  body: string;
  published_at: string;
  read_at: string | null;
}

export const TYPE_ICON: Record<Notification['type'], string> = {
  announcement: '📣',
  restock: '📦',
  maintenance: '🛠',
};

/** Poll interval for the badge — slow enough to be free, fast enough to feel live. */
const POLL_MS = 60_000;
const PANEL_LIMIT = 8;

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const refreshCount = useCallback(() => {
    api<{ unread: number }>('/api/brand/notifications/unread-count')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined); // a failed poll must never surface as a UI error
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    api<{ notifications: Notification[] }>(`/api/brand/notifications?limit=${PANEL_LIMIT}`)
      .then((r) => setItems(r.notifications))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  async function openItem(n: Notification) {
    if (!n.read_at) {
      try {
        await api(`/api/brand/notifications/${n.id}/read`, { method: 'POST' });
        setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        // Non-fatal: navigation still happens, and the count self-corrects on the next poll.
      }
    }
    setOpen(false);
    navigate('/app/notifications');
  }

  async function markAll() {
    try {
      await api('/api/brand/notifications/read-all', { method: 'POST' });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? now })));
      setUnread(0);
    } catch {
      refreshCount();
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        className="btn-ghost relative text-sm"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent px-1 text-2xs font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[340px] overflow-hidden rounded-xl border border-line bg-white shadow-2xl dark:border-line dark:bg-surface-1">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5 dark:border-line">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button className="text-xs text-accent hover:underline" onClick={markAll}>Mark all read</button>}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="px-3.5 py-8 text-center text-xs text-content-muted">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-xs text-content-muted">Nothing yet.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-2.5 border-b border-line/60 px-3.5 py-2.5 text-left last:border-0 hover:bg-slate-50 dark:border-line/60 dark:hover:bg-surface-1 ${
                    n.read_at ? '' : 'bg-accent/[0.06]'
                  }`}
                >
                  <span className="mt-0.5 text-sm" aria-hidden>{TYPE_ICON[n.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                      <span className={`truncate text-sm ${n.read_at ? 'text-slate-600 dark:text-content-muted' : 'font-semibold'}`}>{n.title}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-content-muted">{n.body}</span>
                    <span className="mt-0.5 block text-2xs text-content-faint">{relativeTime(n.published_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          <button
            className="w-full border-t border-line px-3.5 py-2.5 text-xs text-accent hover:bg-slate-50 dark:border-line dark:hover:bg-surface-1"
            onClick={() => { setOpen(false); navigate('/app/notifications'); }}
          >
            View all
          </button>
        </div>
      )}
    </div>
  );
}
