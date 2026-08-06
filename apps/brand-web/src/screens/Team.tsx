import { useEffect, useState } from 'react';
import { brandRoleLabel, type BrandMemberRole } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';

/**
 * Team (architecture §3.1). Invites are LINK-based: we mint a Supabase action
 * link and the owner delivers it themselves, because no transactional SMTP is
 * configured for brand auth mail yet.
 */
interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: BrandMemberRole;
  status: 'active' | 'invited' | 'suspended';
  pending: boolean;
  invited_at: string | null;
  is_you: boolean;
}

export function Team() {
  const [members, setMembers] = useState<Member[]>([]);
  const [yourRole, setYourRole] = useState<BrandMemberRole>('staff');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const isOwner = yourRole === 'owner';

  function load() {
    setLoading(true);
    api<{ members: Member[]; your_role: BrandMemberRole }>('/api/brand/members')
      .then((r) => { setMembers(r.members); setYourRole(r.your_role); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load your team'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function act(fn: () => Promise<unknown>) {
    setErr('');
    try {
      await fn();
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That did not work');
    }
  }

  async function resend(m: Member) {
    setErr('');
    try {
      const r = await api<{ invite_link: string | null }>(`/api/brand/members/${m.user_id}/invite-link`, { method: 'POST' });
      if (r.invite_link) setLink({ email: m.email ?? '', url: r.invite_link });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not create a new link');
    }
  }

  return (
    <>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold">Team</h1>
          <p className="text-sm text-content-muted">
            Staff can run orders, tracking, claims and customers, and browse the catalog. Only an owner can set pricing —
            retail prices and shipping markup — add products to your store, or touch billing, the wallet, your store
            connection, branding or the team.
          </p>
        </div>
        {isOwner && <button className="btn" onClick={() => setInviting(true)}>Invite someone</button>}
      </div>

      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      {link && <InviteLink email={link.email} url={link.url} onClose={() => setLink(null)} />}

      {loading ? (
        <div className="surface p-10 text-center text-content-muted">Loading…</div>
      ) : (
        <div className="surface divide-y divide-lline dark:divide-line">
          {members.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium">{m.full_name ?? m.email ?? 'Unknown'}</span>
                  {m.is_you && <span className="pill border-white/15 bg-white/5 text-content-muted">you</span>}
                  <span className={`pill ${m.role === 'owner' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/15 bg-white/5 text-content-muted'}`}>
                    {brandRoleLabel(m.role)}
                  </span>
                  {m.status === 'suspended' ? (
                    <span className="pill border-danger/40 bg-danger/10 text-danger">access revoked</span>
                  ) : m.pending ? (
                    <span className="pill border-warning/40 bg-warning/10 text-warning">pending — hasn’t signed in</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-content-muted">{m.email}</div>
              </div>

              {isOwner && !m.is_you && (
                <div className="flex flex-wrap gap-2">
                  {m.pending && m.status !== 'suspended' && (
                    <button className="btn-ghost text-xs" onClick={() => resend(m)}>Get link</button>
                  )}
                  {m.status === 'suspended' ? (
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => act(() => api(`/api/brand/members/${m.user_id}/reactivate`, { method: 'POST' }))}
                    >
                      Restore access
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() =>
                          act(() =>
                            api(`/api/brand/members/${m.user_id}`, {
                              method: 'PATCH',
                              body: { role: m.role === 'owner' ? 'staff' : 'owner' },
                            }),
                          )
                        }
                      >
                        Make {m.role === 'owner' ? 'staff' : 'owner'}
                      </button>
                      <button
                        className="btn-ghost text-xs text-danger"
                        onClick={() => {
                          if (confirm(`Revoke access for ${m.full_name ?? m.email}? They lose access immediately.`)) {
                            void act(() => api(`/api/brand/members/${m.user_id}`, { method: 'DELETE' }));
                          }
                        }}
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {inviting && (
        <InviteForm
          onClose={() => setInviting(false)}
          onInvited={(email, url) => { setInviting(false); setLink({ email, url }); load(); }}
        />
      )}
    </>
  );
}

function InviteForm({ onClose, onInvited }: { onClose: () => void; onInvited: (email: string, url: string) => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<BrandMemberRole>('staff');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ invite_link: string | null }>('/api/brand/members', {
        method: 'POST',
        body: { email, full_name: fullName, role },
      });
      onInvited(email, r.invite_link ?? '');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Invite failed');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="surface w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold">Invite a team member</div>
        {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-content-muted">Full name</span>
          <input className="app-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-content-muted">Email</span>
          <input className="app-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-content-muted">Role</span>
          <select className="app-input" value={role} onChange={(e) => setRole(e.target.value as BrandMemberRole)}>
            <option value="staff">Staff — orders, tracking, claims, customers (no pricing)</option>
            <option value="owner">Owner — full access including billing and the wallet</option>
          </select>
        </label>

        <p className="mb-4 text-xs text-content-muted">
          We’ll generate a sign-up link for you to send them. It sets their password and activates their access.
        </p>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn flex-1" onClick={submit} disabled={busy || !email || !fullName}>
            {busy ? '…' : 'Create invite'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The link is shown ONCE per generation — copyable, with an explicit warning. */
function InviteLink({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="surface mb-4 border-accent/40 p-4">
      <div className="mb-1 text-base font-semibold">Send this link to {email || 'your new team member'}</div>
      <p className="mb-3 text-xs text-content-muted">
        It lets them set a password and sign in. Treat it like a password — anyone with the link can claim the account.
        You can generate a fresh one at any time.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="app-input flex-1 font-mono text-xs" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn-ghost" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
