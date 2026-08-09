import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { TYPE_ICON, relativeTime, type Notification } from '../components/NotificationBell.js';
import { Button, cardClass, chipClass } from '@ruostack/ui';

/**
 * Full notifications history. The bell panel shows the most recent few; this is
 * the whole visible feed, with unread-only filtering.
 *
 * Distinct from Action Required, which is order blockers — this is platform
 * news, restocks and maintenance notices from the operator.
 */
export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  function load(unread: boolean) {
    setLoading(true);
    api<{ notifications: Notification[] }>(`/api/brand/notifications${unread ? '?unread=true' : ''}`)
      .then((r) => setItems(r.notifications))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load notifications'))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(unreadOnly); }, [unreadOnly]);

  const unreadCount = items.filter((n) => !n.read_at).length;

  async function markRead(n: Notification) {
    if (n.read_at) return;
    try {
      await api(`/api/brand/notifications/${n.id}/read`, { method: 'POST' });
      setItems((prev) =>
        unreadOnly
          ? prev.filter((i) => i.id !== n.id)
          : prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)),
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not mark that as read');
    }
  }

  async function markAll() {
    try {
      await api('/api/brand/notifications/read-all', { method: 'POST' });
      load(unreadOnly);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not mark all read');
    }
  }

  return (
    <>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-content-muted">Platform announcements, restocks and maintenance notices.</p>
        </div>
        {unreadCount > 0 && <Button variant="ghost" className="text-xs" onClick={markAll}>Mark all read</Button>}
      </div>

      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      <div className="mb-4 flex gap-2">
        <button className={chipClass(!unreadOnly)} onClick={() => setUnreadOnly(false)}>All</button>
        <button className={chipClass(unreadOnly)} onClick={() => setUnreadOnly(true)}>
          Unread{unreadCount > 0 && <span className="ml-1.5 opacity-70">{unreadCount}</span>}
        </button>
      </div>

      {loading ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : items.length === 0 ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>
          {unreadOnly ? 'Nothing unread. 🎉' : 'No notifications yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div
              key={n.id}
              className={cardClass(`flex items-start gap-3 p-4 ${n.read_at ? '' : 'border-accent/30'}`)}
            >
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-base" aria-hidden>
                {TYPE_ICON[n.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                  <span className={`text-base ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-content-muted">{n.body}</p>
                <div className="mt-1.5 text-xs text-content-faint">{relativeTime(n.published_at)}</div>
              </div>
              {!n.read_at && (
                <Button variant="ghost" className="shrink-0 text-xs" onClick={() => markRead(n)}>Mark read</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
