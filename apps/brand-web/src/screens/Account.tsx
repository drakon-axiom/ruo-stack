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
    try {
      // Server-side + audited (see PATCH /api/brand/account/email).
      await api('/api/brand/account/email', { method: 'PATCH', body: { email: next } });
      setErr('');
      setMsg('Login email updated.');
      void load();
    } catch (e) {
      setMsg('');
      setErr(e instanceof ApiError ? e.message : 'Could not change email');
    }
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

interface PlanCard {
  key: 'starter' | 'pro' | 'volume';
  name: string;
  price_cents: number;
  paid: boolean;
  features: string[];
}
interface Sub {
  status: 'none' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  current_plan: 'starter' | 'pro' | 'volume';
  billed_plan: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  grace_ends_at: string | null;
  payment_action_needed: boolean;
  plans: PlanCard[];
}

function SubscriptionSection() {
  const [sub, setSub] = useState<Sub | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api<Sub>('/api/brand/subscription').then(setSub).catch(() => setErr('Could not load subscription'));
  }
  useEffect(load, []);

  async function choose(plan: PlanCard) {
    setErr('');
    setBusy(true);
    try {
      if (plan.paid) {
        const { url } = await api<{ url: string }>('/api/brand/billing/subscribe', { method: 'POST', body: { plan: plan.key } });
        window.location.href = url;
      } else {
        // Downgrade to free Starter = cancel the paid plan in the Stripe portal.
        const { url } = await api<{ url: string }>('/api/brand/billing/portal-session', { method: 'POST' });
        window.location.href = url;
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not continue');
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

  const current = sub?.current_plan ?? 'starter';
  const status = sub?.status ?? 'none';
  const onPaid = current === 'pro' || current === 'volume';
  const dollars = (c: number) => (c === 0 ? 'Free' : `$${c / 100}/mo`);

  return (
    <Section title="Subscription">
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

      {status === 'past_due' && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13px] text-amber">
          <span>
            Payment failed — your plan features stay active{sub?.grace_ends_at ? ` until ${new Date(sub.grace_ends_at).toLocaleDateString()}` : ''}. Update your card to avoid interruption.
          </span>
          <button className="btn shrink-0" disabled={busy} onClick={manage}>Update payment method</button>
        </div>
      )}
      {status === 'suspended' && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <span>Membership suspended for non-payment — fulfillment features are paused. Update your payment method to restore them.</span>
          <button className="btn shrink-0" disabled={busy} onClick={manage}>Update payment method</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {(sub?.plans ?? []).map((p) => {
          const isCurrent = p.key === current;
          return (
            <div key={p.key} className={`rounded-card border p-4 ${isCurrent ? 'border-teal bg-teal/5' : 'border-lline dark:border-line'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">{p.name}</span>
                {isCurrent && <span className="pill border-teal/40 bg-teal/10 text-teal">Current</span>}
              </div>
              <div className="mt-1 text-[20px] font-extrabold">{dollars(p.price_cents)}</div>
              <ul className="mt-3 space-y-1.5 text-[12px] text-muted">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-1.5"><span className="text-teal">✓</span>{f}</li>
                ))}
              </ul>
              <button
                className={`mt-4 w-full ${isCurrent ? 'btn-ghost opacity-60' : 'btn'}`}
                disabled={isCurrent || busy}
                onClick={() => choose(p)}
              >
                {isCurrent ? 'Current plan' : p.paid ? `Choose ${p.name}` : 'Downgrade to Starter'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
        <span>
          {sub?.current_period_end && status === 'active' && (
            sub.cancel_at_period_end ? (
              <span className="text-amber">Ends {new Date(sub.current_period_end).toLocaleDateString()} — won't renew.</span>
            ) : (
              <>Renews {new Date(sub.current_period_end).toLocaleDateString()}.</>
            )
          )}
        </span>
        {onPaid && <button className="text-teal hover:underline" onClick={manage}>Manage billing →</button>}
      </div>
    </Section>
  );
}
