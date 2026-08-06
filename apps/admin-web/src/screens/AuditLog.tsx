import { useEffect, useState } from 'react';
import {
  Badge,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Toolbar,
  type Column,
} from '@ruostack/ui';
import { api } from '../lib/api.js';

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

// scroll mode: an audit row is only meaningful read across — when, who, what,
// against which target. Splitting it into a stacked card loses the sequence.
const COLUMNS: Column<Entry>[] = [
  {
    key: 'when',
    header: 'When',
    priority: 'primary',
    minWidth: 170,
    cell: (e) => new Date(e.createdAt).toLocaleString(),
  },
  { key: 'actor', header: 'Actor', minWidth: 90, cell: (e) => <Badge>{e.actorType}</Badge> },
  {
    key: 'action',
    header: 'Action',
    mono: true,
    minWidth: 200,
    cell: (e) => <span className="text-accent-hover">{e.action}</span>,
  },
  {
    key: 'target',
    header: 'Target',
    minWidth: 160,
    cell: (e) => (e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}…` : '—'),
  },
  { key: 'ip', header: 'IP', minWidth: 110, cell: (e) => e.ip ?? '—' },
];

const ACTORS = [
  { value: 'all', label: 'All actors' },
  { value: 'admin', label: 'admin' },
  { value: 'brand', label: 'brand' },
  { value: 'system', label: 'system' },
];

export function AuditLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [actorType, setActorType] = useState('all');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (actorType !== 'all') qs.set('actor_type', actorType);
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
      <PageHeader
        title="Audit Log"
        subtitle="Append-only record of every mutating admin action and sensitive brand action."
      />

      <Toolbar>
        <Select
          className="max-w-[160px]"
          value={actorType}
          onValueChange={setActorType}
          options={ACTORS}
        />
        <Input
          className="max-w-xs"
          aria-label="Filter by action"
          placeholder="Filter by action (e.g. catalog.updated)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </Toolbar>

      <DataTable
        caption="Audit log entries"
        mode="scroll"
        columns={COLUMNS}
        rows={entries}
        rowKey={(e) => e.id}
        loading={loading}
        empty={
          <EmptyState
            title="No audit entries"
            hint="Actions will appear here as admins and brands make changes."
          />
        }
      />
    </>
  );
}
