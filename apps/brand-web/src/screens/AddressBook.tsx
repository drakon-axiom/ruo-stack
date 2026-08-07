import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { buttonClass, cardClass, inputClass } from '@ruostack/ui';

export interface Address {
  id: string;
  label: string | null;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
}

type Form = {
  label: string;
  recipient_name: string;
  recipient_email: string;
  recipient_phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

const EMPTY: Form = {
  label: '', recipient_name: '', recipient_email: '', recipient_phone: '',
  address1: '', address2: '', city: '', state: '', zip: '', country: 'US',
};

const toForm = (a: Address): Form => ({
  label: a.label ?? '',
  recipient_name: a.recipient_name,
  recipient_email: a.recipient_email ?? '',
  recipient_phone: a.recipient_phone ?? '',
  address1: a.address1,
  address2: a.address2 ?? '',
  city: a.city,
  state: a.state,
  zip: a.zip,
  country: a.country,
});

// Address Book — saved ship-to addresses that auto-fill the manual order form.
export function AddressBook() {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Address | 'new' | null>(null);

  function load() {
    api<{ addresses: Address[] }>('/api/brand/addresses').then((r) => setAddresses(r.addresses));
  }
  useEffect(load, []);

  async function remove(a: Address) {
    if (!confirm(`Delete ${a.label || a.recipient_name} from your address book?`)) return;
    await api(`/api/brand/addresses/${a.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Address Book</h1>
        {addresses && addresses.length > 0 && (
          <button className={buttonClass('primary', 'md')} onClick={() => setEditing('new')}>+ Add address</button>
        )}
      </div>
      <p className="mb-5 text-sm text-content-muted">
        Saved ship-to addresses. Pick one on the order form to fill the recipient details instantly.
      </p>

      {!addresses ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : addresses.length === 0 ? (
        <div className={cardClass('flex flex-col items-center gap-3 px-6 py-16 text-center')}>
          <div className="text-lg font-semibold">No saved addresses yet</div>
          <div className="max-w-md text-sm text-content-muted">
            Add addresses you ship to often, or tick “Save this address” when placing an order.
          </div>
          <button className={buttonClass('primary', 'md', 'mt-1')} onClick={() => setEditing('new')}>+ Add your first address</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <div key={a.id} className={cardClass('flex flex-col px-4 py-3')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  {a.label && <div className="text-2xs font-semibold uppercase tracking-wide text-accent">{a.label}</div>}
                  <div className="font-medium">{a.recipient_name}</div>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button className={buttonClass('ghost', 'md')} onClick={() => setEditing(a)}>Edit</button>
                  <button className="text-content-faint hover:text-danger" onClick={() => remove(a)}>Delete</button>
                </div>
              </div>
              <div className="mt-1 text-xs text-content-muted">
                {a.address1}{a.address2 ? `, ${a.address2}` : ''}<br />
                {a.city}, {a.state} {a.zip}{a.country !== 'US' ? ` · ${a.country}` : ''}
              </div>
              {(a.recipient_email || a.recipient_phone) && (
                <div className="mt-1 text-xs text-content-faint">
                  {[a.recipient_email, a.recipient_phone].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AddressModal
          address={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function AddressModal({ address, onClose, onSaved }: { address: Address | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(address ? toForm(address) : EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Form>) => setF((prev) => ({ ...prev, ...patch }));
  const valid = f.recipient_name && f.address1 && f.city && f.state && f.zip;

  async function save() {
    setErr('');
    setBusy(true);
    try {
      const body = {
        label: f.label || undefined,
        recipient_name: f.recipient_name,
        recipient_email: f.recipient_email || undefined,
        recipient_phone: f.recipient_phone || undefined,
        address1: f.address1,
        address2: f.address2 || undefined,
        city: f.city,
        state: f.state,
        zip: f.zip,
        country: f.country || 'US',
      };
      if (address) await api(`/api/brand/addresses/${address.id}`, { method: 'PATCH', body });
      else await api('/api/brand/addresses', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save address');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div className={cardClass('w-full max-w-md p-5')} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{address ? 'Edit address' : 'Add address'}</h2>
          <button onClick={onClose} className="text-content-faint hover:text-content">✕</button>
        </div>
        {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
        <div className="space-y-2">
          <input className={inputClass()} placeholder="Label (optional, e.g. “John — home”)" value={f.label} onChange={(e) => set({ label: e.target.value })} />
          <input className={inputClass()} placeholder="Recipient name" value={f.recipient_name} onChange={(e) => set({ recipient_name: e.target.value })} />
          <input className={inputClass()} placeholder="Email (optional)" value={f.recipient_email} onChange={(e) => set({ recipient_email: e.target.value })} />
          <input className={inputClass()} placeholder="Phone (optional)" value={f.recipient_phone} onChange={(e) => set({ recipient_phone: e.target.value })} />
          <input className={inputClass()} placeholder="Address line 1" value={f.address1} onChange={(e) => set({ address1: e.target.value })} />
          <input className={inputClass()} placeholder="Address line 2 (optional)" value={f.address2} onChange={(e) => set({ address2: e.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input className={inputClass()} placeholder="City" value={f.city} onChange={(e) => set({ city: e.target.value })} />
            <input className={inputClass()} placeholder="State" value={f.state} onChange={(e) => set({ state: e.target.value })} />
            <input className={inputClass()} placeholder="ZIP" value={f.zip} onChange={(e) => set({ zip: e.target.value })} />
          </div>
        </div>
        <button className={buttonClass('primary', 'md', 'mt-4 w-full')} disabled={!valid || busy} onClick={save}>{busy ? '…' : address ? 'Save changes' : 'Add address'}</button>
      </div>
    </div>
  );
}
