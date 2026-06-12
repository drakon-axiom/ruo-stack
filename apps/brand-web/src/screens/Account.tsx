import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

interface Me {
  profile: { id: string; full_name: string; name_last_changed_at: string | null; name_editable: boolean };
  brand: {
    id: string;
    brand_name: string;
    website: string | null;
    sales_channel: string | null;
    subscription_status: 'none' | 'pro';
    member_since: string;
    referral_code: string;
  };
  membership: { role: string; status: string };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface mb-5 p-5">
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}

export function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [fullName, setFullName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [website, setWebsite] = useState('');
  const [channel, setChannel] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const data = await api<Me>('/api/brand/me');
    setMe(data);
    setFullName(data.profile.full_name);
    setBrandName(data.brand.brand_name);
    setWebsite(data.brand.website ?? '');
    setChannel(data.brand.sales_channel ?? '');
  }
  useEffect(() => {
    void load();
  }, []);

  async function saveProfile() {
    setMsg('');
    setErr('');
    try {
      await api('/api/brand/profile', {
        method: 'PATCH',
        body: {
          ...(me?.profile.name_editable && fullName !== me.profile.full_name ? { full_name: fullName } : {}),
          brand_name: brandName,
          website,
          sales_channel: channel,
        },
      });
      setMsg('Saved.');
      void load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    }
  }

  async function changeEmail() {
    const next = prompt('New email address');
    if (!next) return;
    const { error } = await supabase.auth.updateUser({ email: next });
    setMsg(error ? '' : 'Confirmation sent to the new address.');
    setErr(error?.message ?? '');
  }

  async function resetPassword() {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(data.user.email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    setMsg(error ? '' : 'Password reset email sent.');
    setErr(error?.message ?? '');
  }

  if (!me) return <div className="surface p-10 text-center text-muted">Loading…</div>;

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Account</h1>
      <p className="mb-6 text-[13px] text-muted">Member since {new Date(me.brand.member_since).toLocaleDateString()}.</p>

      {msg && <div className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-success">{msg}</div>}
      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

      <Section title="Profile information">
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1 block">Full name</span>
            <input className="app-input" value={fullName} disabled={!me.profile.name_editable} onChange={(e) => setFullName(e.target.value)} />
            {!me.profile.name_editable && (
              <span className="mt-1 block text-[11px] text-faint">Name can only be changed once every 7 days.</span>
            )}
          </label>
          <label className="block">
            <span className="label mb-1 block">Research company name</span>
            <input className="app-input" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label mb-1 block">Website</span>
              <input className="app-input" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            <label className="block">
              <span className="label mb-1 block">Sales channel</span>
              <input className="app-input" value={channel} onChange={(e) => setChannel(e.target.value)} />
            </label>
          </div>
          <button className="btn" onClick={saveProfile}>Save profile</button>
        </div>
      </Section>

      <Section title="Email">
        <p className="mb-3 text-[13px] text-muted">Changing your email sends a confirmation to the new address (Supabase Auth).</p>
        <button className="btn-ghost" onClick={changeEmail}>Change email</button>
      </Section>

      <Section title="Password">
        <p className="mb-3 text-[13px] text-muted">We'll email you a secure reset link.</p>
        <button className="btn-ghost" onClick={resetPassword}>Send password reset</button>
      </Section>

      <SubscriptionSection />

      <Section title="Referrals">
        <p className="text-[13px] text-muted">Your referral code:</p>
        <div className="mt-1 font-mono text-[15px] text-teal">{me.brand.referral_code}</div>
      </Section>
    </>
  );
}

interface Sub {
  status: 'none' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  price_cents: number;
  current_period_end: string | null;
  is_pro: boolean;
}

const SUB_PILL: Record<string, string> = {
  active: 'border-success/40 bg-success/10 text-success',
  past_due: 'border-amber/40 bg-amber/10 text-amber',
  suspended: 'border-danger/40 bg-danger/10 text-danger',
  cancelled: 'border-line2 bg-card2 text-muted',
  none: 'border-amber/40 bg-amber/10 text-amber',
};

function SubscriptionSection() {
  const [sub, setSub] = useState<Sub | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Sub>('/api/brand/subscription').then(setSub).catch(() => setErr('Could not load subscription'));
  }, []);

  async function subscribe() {
    setErr('');
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/brand/billing/subscribe', { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  }
  async function manage() {
    setErr('');
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/brand/billing/portal-session', { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not open billing portal');
      setBusy(false);
    }
  }

  const status = sub?.status ?? 'none';
  const label = status === 'none' ? 'No plan' : status === 'active' ? 'Pro' : status.replace('_', ' ');

  return (
    <Section title="Subscription">
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

      {status === 'suspended' && (
        <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          Your Pro membership is suspended for non-payment. Fulfillment features are paused — update your payment method to restore them.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <span className={`pill ${SUB_PILL[status]}`}>{label}</span>
          <p className="mt-2 text-[13px] text-muted">
            Pro ($97/mo) unlocks wholesale pricing + fulfillment.
            {sub?.current_period_end && status === 'active' && (
              <> Renews {new Date(sub.current_period_end).toLocaleDateString()}.</>
            )}
          </p>
        </div>
        {status === 'active' || status === 'past_due' || status === 'suspended' ? (
          <button className="btn-ghost" onClick={manage} disabled={busy}>{busy ? '…' : 'Manage subscription'}</button>
        ) : (
          <button className="btn" onClick={subscribe} disabled={busy}>{busy ? '…' : 'Subscribe to Pro'}</button>
        )}
      </div>
    </Section>
  );
}
