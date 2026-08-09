import { useEffect, useState } from 'react';
import { ADMIN_ROLES, type AdminRole } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Button, Check, DataTable, Drawer, EmptyState, Field, InlineAlert, Input, PageHeader, Plus, Select, StatusPill, type Column } from '@ruostack/ui';

interface Admin {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  status: 'active' | 'suspended';
  mfa_enabled: boolean;
  last_login_at: string | null;
}

export function AdminUsers() {
  const { claims } = useAuth();
  const isSuper = claims?.role === 'super_admin';
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const { admins } = await api<{ admins: Admin[] }>('/api/admin/admins');
      setAdmins(admins);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function changeRole(id: string, role: AdminRole) {
    await api(`/api/admin/admins/${id}/role`, { method: 'PATCH', body: { role } });
    void load();
  }
  async function changeStatus(id: string, status: 'active' | 'suspended') {
    await api(`/api/admin/admins/${id}/status`, { method: 'PATCH', body: { status } });
    void load();
  }

  if (!isSuper) {
    return (
      <>
        <PageHeader title="Admin Users & Roles" />
        <EmptyState title="Restricted" hint="Only a super_admin can manage admin users and roles." />
      </>
    );
  }

  // Defined in-component: the cells call changeRole / changeStatus.
  const columns: Column<Admin>[] = [
    { key: 'name', header: 'Name', priority: 'primary', cell: (a) => a.full_name },
    { key: 'email', header: 'Email', priority: 'meta', cell: (a) => a.email },
    {
      key: 'role',
      header: 'Role',
      cell: (a) => (
        <Select
          className="w-40"
          value={a.role}
          onValueChange={(v) => changeRole(a.id, v as AdminRole)}
          options={ADMIN_ROLES.map((r) => ({ value: r, label: r }))}
        />
      ),
    },
    {
      key: 'mfa',
      header: 'MFA',
      cell: (a) =>
        a.mfa_enabled ? (
          <Check aria-label="MFA enabled" className="h-4 w-4 text-success" />
        ) : (
          <span className="text-content-faint">—</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (a) => <StatusPill value={a.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) =>
        a.status === 'active' ? (
          <Button variant="danger" size="sm" onClick={() => changeStatus(a.id, 'suspended')}>
            Suspend
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => changeStatus(a.id, 'active')}>
            Activate
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Admin Users & Roles"
        subtitle="Create admins, grant roles, and suspend access. Every action is audited."
        action={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Create admin
          </Button>
        }
      />
      {err && (
        <div className="mb-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}

      <DataTable
        caption="Admin users, their roles and status"
        columns={columns}
        rows={admins}
        rowKey={(a) => a.id}
        loading={loading}
        empty={<EmptyState title="No admins" hint="Create the first admin to get started." />}
      />

      {creating && <CreateAdmin onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />}
    </>
  );
}

function CreateAdmin({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AdminRole>('operations');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setErr('');
    setBusy(true);
    try {
      const created = await api<{ email_sent?: boolean }>('/api/admin/admins', { method: 'POST', body: { email, full_name: fullName, role } });
      // The account exists either way; only the invite email may have failed.
      if (created?.email_sent === false) {
        setErr('Admin created, but the invite email could not be sent — send the temporary password another way (see API logs).');
        setBusy(false);
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Create failed');
      setBusy(false);
    }
  }

  return (
    <Drawer open title="Create admin" onOpenChange={(o) => { if (!o) onClose(); }} footer={
      <Button className="w-full" onClick={create} disabled={!email || !fullName} loading={busy}>Create + send invite</Button>
    }>
      {err && (
        <div className="mb-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}
      <Field label="Full name">
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role">
        <Select
          value={role}
          onValueChange={(v) => setRole(v as AdminRole)}
          options={ADMIN_ROLES.map((r) => ({ value: r, label: r }))}
        />
      </Field>
      <p className="text-2xs text-content-faint">A temporary password is emailed (console adapter in dev). They enroll TOTP on first login.</p>
    </Drawer>
  );
}
