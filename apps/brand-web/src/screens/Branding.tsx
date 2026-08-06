import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { buttonClass, cardClass, inputClass, labelClass } from '@ruostack/ui';

interface Me {
  brand: {
    brand_name: string;
    logo_url: string | null;
    primary_color: string | null;
    accent_color: string | null;
  };
}

const DEFAULT_PRIMARY = '#14b8a6'; // teal
const DEFAULT_ACCENT = '#0f172a'; // navy
const MAX_BYTES = 512 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });

export function Branding() {
  const [me, setMe] = useState<Me | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const data = await api<Me>('/api/brand/me');
    setMe(data);
    setLogoUrl(data.brand.logo_url);
    setPrimary(data.brand.primary_color ?? DEFAULT_PRIMARY);
    setAccent(data.brand.accent_color ?? DEFAULT_ACCENT);
  }
  useEffect(() => { void load(); }, []);

  function flash(setter: (v: string) => void, text: string) {
    setter(text);
    setTimeout(() => setter(''), 3000);
  }

  async function onPickLogo(file: File | undefined) {
    if (!file) return;
    setErr(''); setMsg('');
    if (file.size > MAX_BYTES) { flash(setErr, 'Logo must be 512 KB or smaller.'); return; }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { logo_url } = await api<{ logo_url: string }>('/api/brand/logo', { method: 'POST', body: { data_url: dataUrl } });
      setLogoUrl(logo_url);
      flash(setMsg, 'Logo updated.');
    } catch (e) {
      flash(setErr, e instanceof ApiError ? e.message : 'Could not upload logo.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setErr(''); setMsg('');
    setBusy(true);
    try {
      await api('/api/brand/logo', { method: 'DELETE' });
      setLogoUrl(null);
      flash(setMsg, 'Logo removed.');
    } catch (e) {
      flash(setErr, e instanceof ApiError ? e.message : 'Could not remove logo.');
    } finally {
      setBusy(false);
    }
  }

  async function saveColors() {
    setErr(''); setMsg('');
    setBusy(true);
    try {
      await api('/api/brand/branding', { method: 'PATCH', body: { primary_color: primary, accent_color: accent } });
      flash(setMsg, 'Colors saved.');
      void load();
    } catch (e) {
      flash(setErr, e instanceof ApiError ? e.message : 'Could not save colors.');
    } finally {
      setBusy(false);
    }
  }

  const colorsDirty = me ? primary !== (me.brand.primary_color ?? DEFAULT_PRIMARY) || accent !== (me.brand.accent_color ?? DEFAULT_ACCENT) : false;
  const brandName = me?.brand.brand_name ?? 'Your Brand';

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Branding</h1>
      <p className="mb-5 text-sm text-content-muted">
        Your logo and colors identify your brand across customer-facing touchpoints. Research use only.
      </p>

      {msg && <div className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{msg}</div>}
      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Logo */}
        <div className={cardClass('p-5')}>
          <h2 className="mb-3 text-lg font-semibold">Logo</h2>
          <div className="mb-4 flex items-center gap-4">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-lg border border-line bg-surface-3 dark:border-line">
              {logoUrl ? (
                <img src={logoUrl} alt="Brand logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-2xs text-content-faint">No logo</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button className={buttonClass('primary', 'md')} disabled={busy} onClick={() => fileRef.current?.click()}>
                {logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              {logoUrl && <button className={buttonClass('ghost', 'md', 'text-xs')} disabled={busy} onClick={removeLogo}>Remove</button>}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onPickLogo(e.target.files?.[0])}
            />
          </div>
          <p className="text-2xs text-content-faint">PNG, JPEG, WebP, or SVG. Up to 512 KB. Square works best.</p>
        </div>

        {/* Colors */}
        <div className={cardClass('p-5')}>
          <h2 className="mb-3 text-lg font-semibold">Brand colors</h2>
          <div className="space-y-3">
            <ColorField label="Primary" value={primary} onChange={setPrimary} />
            <ColorField label="Accent" value={accent} onChange={setAccent} />
          </div>
          <button className={buttonClass('primary', 'md', 'mt-4')} disabled={busy || !colorsDirty} onClick={saveColors}>Save colors</button>
        </div>
      </div>

      {/* Preview */}
      <h2 className="mb-2 mt-6 text-sm uppercase tracking-[0.12em] text-content-faint">Preview</h2>
      <div className={cardClass('overflow-hidden')}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ backgroundColor: accent }}>
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded font-black text-white" style={{ backgroundColor: primary }}>
              {brandName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-lg font-bold text-white">{brandName}</span>
        </div>
        <div className="px-5 py-5">
          <p className="mb-3 text-sm text-content-muted">This is how your brand header looks to customers.</p>
          <button className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: primary }}>
            Primary button
          </button>
        </div>
      </div>
      <p className="mt-3 text-2xs text-content-faint">
        Colors are saved to your brand and used on customer-facing surfaces. The portal chrome keeps the shared theme for now.
      </p>
    </>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent dark:border-line"
      />
      <div className="flex-1">
        <span className={labelClass('mb-1 block')}>{label}</span>
        <input
          className={inputClass('font-mono')}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
          placeholder="#14b8a6"
        />
      </div>
    </div>
  );
}
