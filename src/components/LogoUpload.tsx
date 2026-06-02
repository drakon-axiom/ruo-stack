'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  BRAND_ASSETS_BUCKET,
  MAX_LOGO_BYTES,
  ACCEPTED_LOGO_TYPES,
} from '@/lib/constants';

/**
 * Uploads a brand logo to the `brand-assets` bucket under `<userId>/logo.<ext>`.
 * Storage RLS (0005) only permits writes inside the seller's own folder, so the
 * client-side anon key is safe here. Uses upsert + a cache-busting query param
 * so re-uploads replace the file and still render fresh.
 */
export function LogoUpload({
  userId,
  value,
  onChange,
}: {
  userId: string;
  value: string | null;
  onChange: (url: string) => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setError('Use a PNG, JPG, SVG, or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo must be under 2 MB.');
      return;
    }

    setBusy(true);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const path = `${userId}/logo.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BRAND_ASSETS_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      setBusy(false);
      setError(upErr.message);
      return;
    }

    const { data } = supabase.storage.from(BRAND_ASSETS_BUCKET).getPublicUrl(path);
    setBusy(false);
    onChange(`${data.publicUrl}?v=${Date.now()}`);
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-gray-50">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Brand logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-gray-400">No logo</span>
          )}
        </div>
        <label className="cursor-pointer rounded border px-3 py-2 text-sm hover:bg-gray-50">
          {busy ? 'Uploading…' : value ? 'Replace logo' : 'Upload logo'}
          <input
            type="file"
            accept={ACCEPTED_LOGO_TYPES.join(',')}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-gray-500">
        PNG, JPG, SVG, or WebP · max 2 MB · applies to future orders’ labels & packaging.
      </p>
    </div>
  );
}
