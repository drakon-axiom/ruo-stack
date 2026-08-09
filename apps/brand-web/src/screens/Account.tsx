import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { Badge, Button, Check, Input, buttonClass, cardClass, cn, labelClass } from '@ruostack/ui';

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
    <div className={cardClass('mb-5 p-5')}>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
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

  if (!me) return <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Account</h1>
      <p className="mb-6 text-sm text-content-muted">Member since {new Date(me.brand.member_since).toLocaleDateString()}.</p>

      {msg && <div className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{msg}</div>}
      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      <Section title="Profile information">
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass('mb-1 block')}>Full name</span>
            <Input value={fullName} disabled={!me.profile.name_editable} onChange={(e) => setFullName(e.target.value)} />
            {!me.profile.name_editable && (
              <span className="mt-1 block text-2xs text-content-faint">Name can only be changed once every 7 days.</span>
            )}
          </label>
          <label className="block">
            <span className={labelClass('mb-1 block')}>Research company name</span>
            <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass('mb-1 block')}>Website</span>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelClass('mb-1 block')}>Sales channel</span>
              <Input value={channel} onChange={(e) => setChannel(e.target.value)} />
            </label>
          </div>
          <Button onClick={saveProfile}>Save profile</Button>
        </div>
      </Section>

      <Section title="Email">
        <p className="mb-3 text-sm text-content-muted">Changing your email sends a confirmation to the new address (Supabase Auth).</p>
        <Button variant="ghost" onClick={changeEmail}>Change email</Button>
      </Section>

      <Section title="Password">
        <p className="mb-3 text-sm text-content-muted">We'll email you a secure reset link.</p>
        <Button variant="ghost" onClick={resetPassword}>Send password reset</Button>
      </Section>

      <SubscriptionSection />

      <Section title="Referrals">
        <p className="text-sm text-content-muted">Your referral code:</p>
        <div className="mt-1 font-mono text-lg text-accent">{me.brand.referral_code}</div>
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
  status: 'none' | 'active' | 'past_due' | 'expired' | 'cancelled' | 'suspended';
  current_plan: 'starter' | 'pro' | 'volume';
  billed_plan: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  grace_ends_at: string | null;
  /** Paid-through date has passed (any amount). */
  paid_through_passed: boolean;
  /** Passed by more than the grace margin — entitlement has already dropped. */
  lapsed: boolean;
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
  // The membership ran out for non-payment. NOT the same as a suspended account:
  // nothing is locked, the brand is simply back on Starter. ('suspended' here is
  // only ever a pre-025 row — see the enum comment in schema.prisma.)
  const ended = status === 'expired' || status === 'suspended';
  const dollars = (c: number) => (c === 0 ? 'Free' : `$${c / 100}/mo`);

  return (
    <Section title="Subscription">
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      {status === 'past_due' && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span>
            Payment failed — your plan features stay active{sub?.grace_ends_at ? ` until ${new Date(sub.grace_ends_at).toLocaleDateString()}` : ''}. Update your card to avoid interruption.
          </span>
          <Button className="shrink-0" disabled={busy} onClick={manage}>Update payment method</Button>
        </div>
      )}
      {/* Paid-through has passed but the stored status hasn't caught up (or the
          payment simply never came). The expired banner below takes over once
          the lapse sweep flips the row; this covers the window before that. */}
      {!ended && sub?.paid_through_passed && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>
            Your membership ended {new Date(sub.current_period_end!).toLocaleDateString()}. Renew to keep your plan
            features — they'll drop back to Starter shortly.
          </span>
          <Button className="shrink-0" disabled={busy} onClick={manage}>Renew</Button>
        </div>
      )}
      {ended && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span>
            Your membership expired and you're on the Starter plan. Your account, orders and wallet are unaffected —
            add a payment method to restore your plan pricing.
          </span>
          <Button className="shrink-0" disabled={busy} onClick={manage}>Restore plan</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(sub?.plans ?? []).map((p) => {
          const isCurrent = p.key === current;
          const cta = isCurrent ? 'Current plan' : p.paid ? `Choose ${p.name}` : 'Downgrade to Starter';

          const body = (
            <>
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{p.name}</span>
                {isCurrent && <Badge tone="accent">Current</Badge>}
              </div>
              <div className="mt-1 text-xl font-extrabold tabular-nums">{dollars(p.price_cents)}</div>
              <ul className="mt-3 space-y-1.5 text-xs text-content-muted">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-1.5">
                    <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              {/* Visual only — the whole card is the control, so this must not
                  be a nested <button>. */}
              <span
                aria-hidden
                className={cn(
                  buttonClass(isCurrent ? 'ghost' : 'primary', 'md', 'mt-4 w-full'),
                  isCurrent && 'opacity-60',
                  !isCurrent && 'group-hover:brightness-110',
                )}
              >
                {cta}
              </span>
            </>
          );

          // The current plan is not selectable, so it stays a plain surface.
          if (isCurrent) {
            return (
              <div key={p.key} className="rounded-card border border-accent bg-accent/5 p-4">
                {body}
              </div>
            );
          }

          /* The whole card is the control. Previously only the inner button was
             interactive and the card had no hover state at all, so there was no
             signal that a plan was selectable. One <button> wrapping the card
             gives hover, focus and keyboard for free without nesting controls. */
          return (
            <button
              key={p.key}
              type="button"
              disabled={busy}
              onClick={() => choose(p)}
              aria-label={`${cta}, ${dollars(p.price_cents)}`}
              className="group rounded-card border border-line p-4 text-left transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-0.5 hover:border-accent hover:shadow-e2 disabled:pointer-events-none disabled:opacity-60"
            >
              {body}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-content-muted">
        <span>
          {sub?.current_period_end && (
            // Past-dated first: "Renews <date>" for a date that has already gone
            // by is the exact thing that hid an expired plan for weeks. A stale
            // `status` can still say active, so the DATE decides what we claim.
            sub.paid_through_passed ? (
              <span className="text-danger">
                Expired {new Date(sub.current_period_end).toLocaleDateString()}
                {!sub.lapsed && ' — renew now to keep your plan'}.
              </span>
            ) : status === 'active' ? (
              sub.cancel_at_period_end ? (
                <span className="text-warning">Ends {new Date(sub.current_period_end).toLocaleDateString()} — won't renew.</span>
              ) : (
                <>Renews {new Date(sub.current_period_end).toLocaleDateString()}.</>
              )
            ) : null
          )}
        </span>
        {onPaid && <button className="text-accent hover:underline" onClick={manage}>Manage billing →</button>}
      </div>
    </Section>
  );
}
