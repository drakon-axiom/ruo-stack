'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LogoUpload } from '@/components/LogoUpload';
import { SALES_CHANNELS, EXPERIENCE_LEVELS } from '@/lib/constants';

type Form = {
  full_name: string;
  brand_name: string;
  brand_website: string;
  sales_channel: string;
  experience_level: string;
  return_name: string;
  return_street: string;
  return_street2: string;
  return_city: string;
  return_state: string;
  return_zip: string;
  return_phone: string;
  logo_url: string | null;
};

const EMPTY: Form = {
  full_name: '',
  brand_name: '',
  brand_website: '',
  sales_channel: '',
  experience_level: '',
  return_name: '',
  return_street: '',
  return_street2: '',
  return_city: '',
  return_state: '',
  return_zip: '',
  return_phone: '',
  logo_url: null,
};

const STEPS = ['Brand', 'Selling', 'Return address', 'Logo', 'Review'];

export default function OnboardingPage() {
  const supabase = createClient();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the signed-in user + any existing profile (so onboarding is resumable).
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login?next=/onboarding');
        return;
      }
      setUserId(user.id);
      const { data: p } = await supabase
        .from('profiles')
        .select(
          'full_name, brand_name, brand_website, sales_channel, experience_level, return_name, return_street, return_street2, return_city, return_state, return_zip, return_phone, logo_url'
        )
        .eq('user_id', user.id)
        .single();
      if (p) setForm((f) => ({ ...f, ...stripNulls(p) }));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function canAdvance(): string | null {
    if (step === 0 && !form.brand_name.trim()) return 'Brand name is required.';
    if (step === 2) {
      const need = ['return_name', 'return_street', 'return_city', 'return_state', 'return_zip'] as const;
      if (need.some((k) => !form[k].trim())) return 'A complete return address is required for shipping labels.';
    }
    return null;
  }

  function next() {
    const msg = canAdvance();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function finish() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name || null,
        brand_name: form.brand_name,
        brand_website: form.brand_website || null,
        sales_channel: form.sales_channel || null,
        experience_level: form.experience_level || null,
        return_name: form.return_name,
        return_street: form.return_street,
        return_street2: form.return_street2 || null,
        return_city: form.return_city,
        return_state: form.return_state,
        return_zip: form.return_zip,
        return_phone: form.return_phone || null,
        logo_url: form.logo_url,
        onboarding_complete: true,
      })
      .eq('user_id', userId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  if (loading) {
    return <main className="mx-auto max-w-xl px-6 py-16 text-muted-foreground">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      {/* progress */}
      <ol className="mb-8 flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                i <= step ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? 'font-medium' : 'text-muted-foreground/70'}>{label}</span>
          </li>
        ))}
      </ol>

      <h1 className="text-2xl font-bold">Set up your brand</h1>

      <div className="mt-6 space-y-4">
        {step === 0 && (
          <>
            <Field label="Brand name *">
              <Input value={form.brand_name} onChange={set('brand_name')} placeholder="Apex Nutrition" />
            </Field>
            <Field label="Your name">
              <Input value={form.full_name} onChange={set('full_name')} placeholder="Jane Doe" />
            </Field>
            <Field label="Brand website">
              <Input value={form.brand_website} onChange={set('brand_website')} placeholder="https://apexnutrition.com" />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Where do you sell?">
              <Select value={form.sales_channel} onChange={set('sales_channel')} options={SALES_CHANNELS} />
            </Field>
            <Field label="Experience level">
              <Select value={form.experience_level} onChange={set('experience_level')} options={EXPERIENCE_LEVELS} />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-muted-foreground">
              Used as the “from” address on shipping labels and packaging.
            </p>
            <Field label="Return name *">
              <Input value={form.return_name} onChange={set('return_name')} />
            </Field>
            <Field label="Street *">
              <Input value={form.return_street} onChange={set('return_street')} />
            </Field>
            <Field label="Street line 2">
              <Input value={form.return_street2} onChange={set('return_street2')} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="City *">
                <Input value={form.return_city} onChange={set('return_city')} />
              </Field>
              <Field label="State *">
                <Input value={form.return_state} onChange={set('return_state')} placeholder="CA" />
              </Field>
              <Field label="ZIP *">
                <Input value={form.return_zip} onChange={set('return_zip')} />
              </Field>
            </div>
            <Field label="Phone">
              <Input value={form.return_phone} onChange={set('return_phone')} />
            </Field>
          </>
        )}

        {step === 3 && userId && (
          <Field label="Brand logo">
            <LogoUpload userId={userId} value={form.logo_url} onChange={(url) => set('logo_url')(url)} />
          </Field>
        )}

        {step === 4 && (
          <div className="rounded-lg border p-4 text-sm">
            <Row k="Brand" v={form.brand_name} />
            <Row k="Website" v={form.brand_website || '—'} />
            <Row k="Channel" v={labelOf(SALES_CHANNELS, form.sales_channel)} />
            <Row k="Experience" v={labelOf(EXPERIENCE_LEVELS, form.experience_level)} />
            <Row
              k="Return address"
              v={`${form.return_name}, ${form.return_street}, ${form.return_city} ${form.return_state} ${form.return_zip}`}
            />
            <Row k="Logo" v={form.logo_url ? 'Uploaded' : 'None'} />
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded border px-4 py-2 text-sm disabled:opacity-40"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={next} className="rounded bg-brand px-5 py-2 text-sm font-medium text-white">
            Continue
          </button>
        ) : (
          <button
            onClick={finish}
            disabled={saving}
            className="rounded bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Finish setup'}
          </button>
        )}
      </div>
    </main>
  );
}

// ── small presentational helpers ──────────────────────────────────────────
function stripNulls<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
}
function labelOf(opts: readonly { value: string; label: string }[], v: string) {
  return opts.find((o) => o.value === v)?.label ?? '—';
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border px-3 py-2 text-sm"
    />
  );
}
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border bg-card px-3 py-2 text-sm"
    >
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
