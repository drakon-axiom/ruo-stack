import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, inputClass, labelClass } from '@ruostack/ui';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface Referrals {
  code: string;
  invited: number;
  upgraded: number;
  earned_cents: number;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <Button variant="ghost" className="text-xs" onClick={copy}>{copied ? '✓ Copied' : label}</Button>
  );
}

export function Referrals() {
  const [data, setData] = useState<Referrals | null>(null);

  useEffect(() => { api<Referrals>('/api/brand/referrals').then(setData); }, []);

  const shareLink = data ? `${window.location.origin}/signup?ref=${data.code}` : '';

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Referrals</h1>
      <p className="mb-5 text-sm text-content-muted">
        Invite other brands to RUOStack. Share your link — when they sign up and upgrade, you earn wallet credit.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-3xl font-extrabold">{data ? data.invited : '—'}</div>
          <div className="text-xs text-content-muted">Brands invited</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-extrabold">{data ? data.upgraded : '—'}</div>
          <div className="text-xs text-content-muted">Upgraded to paid</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-extrabold text-accent">{data ? dollars(data.earned_cents) : '—'}</div>
          <div className="text-xs text-content-muted">Wallet credit earned</div>
        </Card>
      </div>

      <Card className="mt-5 p-5">
        <h2 className="mb-3 text-lg font-semibold">Your referral link</h2>
        <div className="mb-3">
          <span className={labelClass('mb-1 block')}>Referral code</span>
          <div className="flex items-center gap-2">
            <div className={inputClass('flex-1 font-mono text-accent')}>{data?.code ?? '…'}</div>
            {data && <CopyButton value={data.code} label="Copy code" />}
          </div>
        </div>
        <div>
          <span className={labelClass('mb-1 block')}>Share link</span>
          <div className="flex items-center gap-2">
            <div className={inputClass('flex-1 truncate text-xs')}>{shareLink || '…'}</div>
            {data && <CopyButton value={shareLink} label="Copy link" />}
          </div>
        </div>
      </Card>

      <Card className="mt-5 p-5 text-sm text-content-muted">
        <h2 className="mb-2 text-lg font-semibold text-content">How it works</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Share your link with another brand or operator.</li>
          <li>They sign up through it — we tag their account to you automatically.</li>
          <li>When they move to a paid plan, you earn wallet credit toward fulfillment.</li>
        </ol>
      </Card>
    </>
  );
}
