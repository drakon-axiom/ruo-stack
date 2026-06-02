'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LogoUpload } from '@/components/LogoUpload';

/**
 * Edit branding after onboarding. Branding changes apply to FUTURE orders'
 * labels & packaging only (already-fulfilled orders keep their original label).
 */
export default function BrandingPage() {
  const supabase = createClient();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState('');
  const [brandWebsite, setBrandWebsite] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login?next=/dashboard/branding');
        return;
      }
      setUserId(user.id);
      const { data: p } = await supabase
        .from('profiles')
        .select('brand_name, brand_website, logo_url')
        .eq('user_id', user.id)
        .single();
      if (p) {
        setBrandName(p.brand_name ?? '');
        setBrandWebsite(p.brand_website ?? '');
        setLogoUrl(p.logo_url ?? null);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!userId) return;
    if (!brandName.trim()) {
      setError('Brand name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setStatus('idle');
    const { error } = await supabase
      .from('profiles')
      .update({
        brand_name: brandName,
        brand_website: brandWebsite || null,
        logo_url: logoUrl,
      })
      .eq('user_id', userId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStatus('saved');
    router.refresh();
  }

  if (loading) {
    return <main className="mx-auto max-w-xl px-6 py-16 text-gray-500">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">Branding</h1>
      <p className="mt-1 text-sm text-gray-500">
        Applies to future orders’ labels & packaging.
      </p>

      <div className="mt-6 space-y-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Brand name</span>
          <input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Brand website</span>
          <input
            value={brandWebsite}
            onChange={(e) => setBrandWebsite(e.target.value)}
            placeholder="https://…"
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium">Logo</span>
          {userId && <LogoUpload userId={userId} value={logoUrl} onChange={setLogoUrl} />}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {status === 'saved' && <p className="text-sm text-emerald-600">Saved.</p>}

        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save branding'}
        </button>
      </div>
    </main>
  );
}
