import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Drawer, EmptyState, Field, PageHeader, Tabs } from '@ruostack/ui';

interface Box {
  id: string;
  name: string;
  innerLengthIn: number;
  innerWidthIn: number;
  innerHeightIn: number;
  maxWeightOz: number;
  tareOz: number;
  enabled: boolean;
  sortOrder: number;
}
interface Service {
  id: string;
  tier: string;
  carrierServiceCode: string;
  displayLabel: string;
  transitEstimate: string;
  maxWeightOz: number;
  enabled: boolean;
  selectionPolicy: string;
  sortOrder: number;
}

type Tab = 'boxes' | 'services';

export function ShippingRules() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'shipping_rules') : false;
  const [tab, setTab] = useState<Tab>('boxes');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [editBox, setEditBox] = useState<Box | 'new' | null>(null);
  const [editSvc, setEditSvc] = useState<Service | 'new' | null>(null);

  function load() {
    api<{ boxes: Box[] }>('/api/admin/shipping/boxes').then((r) => setBoxes(r.boxes));
    api<{ services: Service[] }>('/api/admin/shipping/services').then((r) => setServices(r.services));
  }
  useEffect(load, []);

  async function toggleBox(b: Box) { await api(`/api/admin/shipping/boxes/${b.id}`, { method: 'PATCH', body: { enabled: !b.enabled } }); load(); }
  async function delBox(b: Box) { if (confirm(`Delete box "${b.name}"?`)) { await api(`/api/admin/shipping/boxes/${b.id}`, { method: 'DELETE' }); load(); } }
  async function toggleSvc(s: Service) { await api(`/api/admin/shipping/services/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }); load(); }
  async function delSvc(s: Service) { if (confirm(`Delete service "${s.displayLabel}"?`)) { await api(`/api/admin/shipping/services/${s.id}`, { method: 'DELETE' }); load(); } }

  return (
    <>
      <PageHeader
        title="Shipping Rules"
        subtitle="Box catalog + carrier service mappings for the fulfillment rules engine. Changes take effect at the next rate quote."
        action={writable ? (tab === 'boxes' ? <button className="btn" onClick={() => setEditBox('new')}>+ Box</button> : <button className="btn" onClick={() => setEditSvc('new')}>+ Service</button>) : undefined}
      />

      <div className="mb-3">
        <Tabs<Tab> active={tab} onChange={setTab} tabs={[{ key: 'boxes', label: 'Boxes', count: boxes.length }, { key: 'services', label: 'Services', count: services.length }]} />
      </div>

      {tab === 'boxes' ? (
        boxes.length === 0 ? <EmptyState title="No boxes" hint="Add a box for the rules engine." /> : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-content-faint">
                <th className="px-4 py-3">Name</th><th className="px-4 py-3">Inner L×W×H (in)</th><th className="px-4 py-3">Max wt (oz)</th><th className="px-4 py-3">Tare (oz)</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right"></th>
              </tr></thead>
              <tbody>
                {boxes.map((b) => (
                  <tr key={b.id} className="border-b border-line/60">
                    <td className="px-4 py-3 text-content">{b.name}</td>
                    <td className="px-4 py-3 text-content-muted">{b.innerLengthIn} × {b.innerWidthIn} × {b.innerHeightIn}</td>
                    <td className="px-4 py-3">{b.maxWeightOz}</td>
                    <td className="px-4 py-3 text-content-muted">{b.tareOz}</td>
                    <td className="px-4 py-3"><span className={`pill ${b.enabled ? 'border-success/40 bg-success/10 text-success' : 'border-line-strong bg-surface-3 text-content-muted'}`}>{b.enabled ? 'enabled' : 'disabled'}</span></td>
                    <td className="px-4 py-3 text-right">
                      {writable && <span className="flex justify-end gap-1.5">
                        <button className="btn-ghost text-xs" onClick={() => toggleBox(b)}>{b.enabled ? 'Disable' : 'Enable'}</button>
                        <button className="btn-ghost text-xs" onClick={() => setEditBox(b)}>Edit</button>
                        <button className="btn-ghost text-xs text-danger" onClick={() => delBox(b)}>Delete</button>
                      </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : services.length === 0 ? <EmptyState title="No services" hint="Map carrier services to tiers." /> : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-content-faint">
              <th className="px-4 py-3">Tier</th><th className="px-4 py-3">Service code</th><th className="px-4 py-3">Display label</th><th className="px-4 py-3">Transit</th><th className="px-4 py-3">Max wt</th><th className="px-4 py-3">Policy</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right"></th>
            </tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-content capitalize">{s.tier}</td>
                  <td className="px-4 py-3 font-mono text-2xs text-content-muted">{s.carrierServiceCode}</td>
                  <td className="px-4 py-3">{s.displayLabel}</td>
                  <td className="px-4 py-3 text-content-muted">{s.transitEstimate}</td>
                  <td className="px-4 py-3 text-content-muted">{s.maxWeightOz}</td>
                  <td className="px-4 py-3 text-content-muted">{s.selectionPolicy}</td>
                  <td className="px-4 py-3"><span className={`pill ${s.enabled ? 'border-success/40 bg-success/10 text-success' : 'border-line-strong bg-surface-3 text-content-muted'}`}>{s.enabled ? 'enabled' : 'disabled'}</span></td>
                  <td className="px-4 py-3 text-right">
                    {writable && <span className="flex justify-end gap-1.5">
                      <button className="btn-ghost text-xs" onClick={() => toggleSvc(s)}>{s.enabled ? 'Disable' : 'Enable'}</button>
                      <button className="btn-ghost text-xs" onClick={() => setEditSvc(s)}>Edit</button>
                      <button className="btn-ghost text-xs text-danger" onClick={() => delSvc(s)}>Delete</button>
                    </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editBox && <BoxDrawer box={editBox === 'new' ? null : editBox} onClose={() => setEditBox(null)} onSaved={() => { setEditBox(null); load(); }} />}
      {editSvc && <ServiceDrawer svc={editSvc === 'new' ? null : editSvc} onClose={() => setEditSvc(null)} onSaved={() => { setEditSvc(null); load(); }} />}
    </>
  );
}

function num(v: string) { return Number(v) || 0; }

function BoxDrawer({ box, onClose, onSaved }: { box: Box | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: box?.name ?? '', inner_length_in: String(box?.innerLengthIn ?? ''), inner_width_in: String(box?.innerWidthIn ?? ''),
    inner_height_in: String(box?.innerHeightIn ?? ''), max_weight_oz: String(box?.maxWeightOz ?? ''), tare_oz: String(box?.tareOz ?? '0'),
    sort_order: String(box?.sortOrder ?? '0'),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(''); setBusy(true);
    try {
      const body = { name: f.name, inner_length_in: num(f.inner_length_in), inner_width_in: num(f.inner_width_in), inner_height_in: num(f.inner_height_in), max_weight_oz: num(f.max_weight_oz), tare_oz: num(f.tare_oz), sort_order: num(f.sort_order) };
      if (box) await api(`/api/admin/shipping/boxes/${box.id}`, { method: 'PATCH', body });
      else await api('/api/admin/shipping/boxes', { method: 'POST', body });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Save failed'); setBusy(false); }
  }
  const valid = f.name && num(f.inner_length_in) > 0 && num(f.inner_width_in) > 0 && num(f.inner_height_in) > 0 && num(f.max_weight_oz) > 0;

  return (
    <Drawer open title={box ? 'Edit box' : 'New box'} onOpenChange={(o) => { if (!o) onClose(); }} footer={<button className="btn w-full" disabled={!valid || busy} onClick={save}>{busy ? '…' : 'Save'}</button>}>
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Length (in)"><input className="input" value={f.inner_length_in} onChange={(e) => setF({ ...f, inner_length_in: e.target.value })} /></Field>
        <Field label="Width (in)"><input className="input" value={f.inner_width_in} onChange={(e) => setF({ ...f, inner_width_in: e.target.value })} /></Field>
        <Field label="Height (in)"><input className="input" value={f.inner_height_in} onChange={(e) => setF({ ...f, inner_height_in: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Max wt (oz)"><input className="input" value={f.max_weight_oz} onChange={(e) => setF({ ...f, max_weight_oz: e.target.value })} /></Field>
        <Field label="Tare (oz)"><input className="input" value={f.tare_oz} onChange={(e) => setF({ ...f, tare_oz: e.target.value })} /></Field>
        <Field label="Sort"><input className="input" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

function ServiceDrawer({ svc, onClose, onSaved }: { svc: Service | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    tier: svc?.tier ?? 'economy', carrier_service_code: svc?.carrierServiceCode ?? '', display_label: svc?.displayLabel ?? '',
    transit_estimate: svc?.transitEstimate ?? '', max_weight_oz: String(svc?.maxWeightOz ?? '1120'), selection_policy: svc?.selectionPolicy ?? 'cheapest', sort_order: String(svc?.sortOrder ?? '0'),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(''); setBusy(true);
    try {
      const body = { tier: f.tier, carrier_service_code: f.carrier_service_code, display_label: f.display_label, transit_estimate: f.transit_estimate, max_weight_oz: num(f.max_weight_oz), selection_policy: f.selection_policy, sort_order: num(f.sort_order) };
      if (svc) await api(`/api/admin/shipping/services/${svc.id}`, { method: 'PATCH', body });
      else await api('/api/admin/shipping/services', { method: 'POST', body });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Save failed'); setBusy(false); }
  }
  const valid = f.carrier_service_code && f.display_label && f.transit_estimate && num(f.max_weight_oz) > 0;

  return (
    <Drawer open title={svc ? 'Edit service' : 'New service'} onOpenChange={(o) => { if (!o) onClose(); }} footer={<button className="btn w-full" disabled={!valid || busy} onClick={save}>{busy ? '…' : 'Save'}</button>}>
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Tier">
        <select className="input" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
          <option value="economy">Economy</option><option value="standard">Standard</option><option value="expedited">Expedited</option>
        </select>
      </Field>
      <Field label="Carrier service code"><input className="input font-mono text-xs" placeholder="usps_ground_advantage" value={f.carrier_service_code} onChange={(e) => setF({ ...f, carrier_service_code: e.target.value })} /></Field>
      <Field label="Display label"><input className="input" placeholder="USPS Ground Advantage" value={f.display_label} onChange={(e) => setF({ ...f, display_label: e.target.value })} /></Field>
      <Field label="Transit estimate"><input className="input" placeholder="2–5 business days" value={f.transit_estimate} onChange={(e) => setF({ ...f, transit_estimate: e.target.value })} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Max wt (oz)"><input className="input" value={f.max_weight_oz} onChange={(e) => setF({ ...f, max_weight_oz: e.target.value })} /></Field>
        <Field label="Policy"><select className="input" value={f.selection_policy} onChange={(e) => setF({ ...f, selection_policy: e.target.value })}><option value="cheapest">cheapest</option><option value="fixed">fixed</option></select></Field>
        <Field label="Sort"><input className="input" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
