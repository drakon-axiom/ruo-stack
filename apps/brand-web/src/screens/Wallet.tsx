import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

interface Entry {
  id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  reason: string | null;
  created_at: string;
}
interface WalletData {
  balance_cents: number;
  entries: Entry[];
}

const dollars = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const PRESETS = [2500, 5000, 10000, 25000];

export function Wallet() {
  const [data, setData] = useState<WalletData | null>(null);
  const [modal, setModal] = useState(false);
  const [banner, setBanner] = useState('');

  async function load() {
    setData(await api<WalletData>('/api/brand/wallet'));
  }
  useEffect(() => {
    void load();
    // surface Stripe Checkout return status
    const q = new URLSearchParams(window.location.search).get('status');
    if (q === 'success') setBanner('Payment received — your balance updates as soon as the webhook confirms it.');
    if (q === 'cancelled') setBanner('Top-up cancelled.');
  }, []);

  const deposited = (data?.entries ?? []).filter((e) => e.amount_cents > 0).reduce((s, e) => s + e.amount_cents, 0);
  const spent = (data?.entries ?? []).filter((e) => e.amount_cents < 0).reduce((s, e) => s + e.amount_cents, 0);

  return (
    <>
      <div className="mb-1 flex items-end justify-between">
        <div>
          <h1 className="text-[23px] font-bold">Wallet</h1>
          <p className="mt-1 text-[13px] text-muted">Prepaid balance for fulfillment. Funds are non-refundable.</p>
        </div>
        <button className="btn" onClick={() => setModal(true)}>+ Add funds</button>
      </div>

      {banner && (
        <div className="mt-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-success">{banner}</div>
      )}

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="surface p-4">
          <div className="text-[26px] font-extrabold text-teal">{data ? dollars(data.balance_cents) : '—'}</div>
          <div className="text-[12px] text-muted">Available balance</div>
        </div>
        <div className="surface p-4">
          <div className="text-[26px] font-extrabold">{dollars(deposited)}</div>
          <div className="text-[12px] text-muted">Total deposited</div>
        </div>
        <div className="surface p-4">
          <div className="text-[26px] font-extrabold">{dollars(spent)}</div>
          <div className="text-[12px] text-muted">Total spent</div>
        </div>
      </div>

      <h2 className="mb-2 mt-6 text-[13px] uppercase tracking-[0.12em] text-faint">Ledger</h2>
      {!data ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : data.entries.length === 0 ? (
        <div className="surface p-10 text-center text-muted">No transactions yet. Add funds to get started.</div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3 text-muted">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className="pill">{e.type.replace(/_/g, ' ')}</span></td>
                  <td className={`px-4 py-3 text-right font-medium ${e.amount_cents >= 0 ? 'text-success' : 'text-danger'}`}>
                    {e.amount_cents >= 0 ? '+' : ''}{dollars(e.amount_cents)}
                  </td>
                  <td className="px-4 py-3 text-right">{dollars(e.balance_after_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <AddFunds onClose={() => setModal(false)} />}
    </>
  );
}

function AddFunds({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState(5000);
  const [custom, setCustom] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const cents = custom ? Math.round(parseFloat(custom || '0') * 100) : amount;

  async function go() {
    setErr('');
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/brand/wallet/topup', {
        method: 'POST',
        body: { amount_cents: cents, acknowledge: true },
      });
      window.location.href = url; // hosted Stripe Checkout
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div className="surface w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-[17px] font-semibold">Add funds</h2>
        <p className="mb-4 text-[12px] text-muted">Choose an amount to load into your prepaid wallet.</p>
        {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

        <div className="mb-3 grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setAmount(p); setCustom(''); }}
              className={`rounded-lg border px-2 py-2 text-[13px] ${!custom && amount === p ? 'border-teal bg-teal/10 text-teal' : 'border-lline text-muted dark:border-line'}`}
            >
              ${p / 100}
            </button>
          ))}
        </div>
        <label className="mb-3 block">
          <span className="label mb-1 block">Custom amount ($)</span>
          <input className="app-input" inputMode="decimal" placeholder="e.g. 75" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </label>

        <label className="mb-4 flex items-start gap-2 text-[12px] text-muted">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand wallet funds are <strong className="text-text">non-refundable and non-withdrawable</strong>, usable only for RUOStack fulfillment services.</span>
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!ack || cents < 1000 || busy} onClick={go}>
            {busy ? '…' : `Add ${dollars(cents)}`}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-faint">Minimum $10. Opens secure Stripe Checkout.</p>
      </div>
    </div>
  );
}
