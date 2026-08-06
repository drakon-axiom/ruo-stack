import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { EmptyState, PageHeader, cardClass, inputClass, pillClass } from '@ruostack/ui';

interface Entry {
  id: string;
  actorType: 'admin' | 'brand' | 'system';
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export function AuditLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [actorType, setActorType] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (actorType) qs.set('actor_type', actorType);
    if (action) qs.set('action', action);
    const { entries } = await api<{ entries: Entry[] }>(`/api/admin/audit-log?${qs.toString()}`);
    setEntries(entries);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorType, action]);

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Append-only record of every mutating admin action and sensitive brand action." />

      <div className="mb-3 flex flex-wrap gap-2">
        <select className={inputClass('max-w-[160px]')} value={actorType} onChange={(e) => setActorType(e.target.value)}>
          <option value="">All actors</option>
          <option value="admin">admin</option>
          <option value="brand">brand</option>
          <option value="system">system</option>
        </select>
        <input className={inputClass('max-w-xs')} placeholder="Filter by action (e.g. catalog.updated)" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>

      {loading ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : entries.length === 0 ? (
        <EmptyState title="No audit entries" hint="Actions will appear here as admins and brands make changes." />
      ) : (
        <div className={cardClass('overflow-hidden')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-content-faint">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-content-muted">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={pillClass()}>{e.actorType}</span></td>
                  <td className="px-4 py-3 font-mono text-xs text-accent-hover">{e.action}</td>
                  <td className="px-4 py-3 text-content-muted">{e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}…` : '—'}</td>
                  <td className="px-4 py-3 text-content-faint">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
