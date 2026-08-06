import { useEffect, useState } from 'react';
import { ADMIN_ROLES, type AdminRole } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Drawer, EmptyState, Field, PageHeader, StatusPill, buttonClass, cardClass, inputClass } from '@ruostack/ui';

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

  return (
    <>
      <PageHeader
        title="Admin Users & Roles"
        subtitle="Create admins, grant roles, and suspend access. Every action is audited."
        action={<button className={buttonClass('primary', 'md')} onClick={() => setCreating(true)}>+ Create admin</button>}
      />
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      {loading ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : (
        <div className={cardClass('overflow-hidden')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-content-faint">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">MFA</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-content">{a.full_name}</td>
                  <td className="px-4 py-3 text-content-muted">{a.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-line bg-surface-3 px-2 py-1 text-xs"
                      value={a.role}
                      onChange={(e) => changeRole(a.id, e.target.value as AdminRole)}
                    >
                      {ADMIN_ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-content-muted">{a.mfa_enabled ? '✓' : '—'}</td>
                  <td className="px-4 py-3"><StatusPill value={a.status} /></td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'active' ? (
                      <button className={buttonClass('danger', 'md')} onClick={() => changeStatus(a.id, 'suspended')}>Suspend</button>
                    ) : (
                      <button className={buttonClass('ghost', 'md')} onClick={() => changeStatus(a.id, 'active')}>Activate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
      <button className={buttonClass('primary', 'md', 'w-full')} onClick={create} disabled={busy || !email || !fullName}>
        {busy ? '…' : 'Create + send invite'}
      </button>
    }>
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Full name">
        <input className={inputClass()} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label="Email">
        <input className={inputClass()} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role">
        <select className={inputClass()} value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
          {ADMIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <p className="text-2xs text-content-faint">A temporary password is emailed (console adapter in dev). They enroll TOTP on first login.</p>
    </Drawer>
  );
}
