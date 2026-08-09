import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Badge, Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Plus, Tabs, cardClass, inputClass, type Column } from '@ruostack/ui';

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

  const rowActions = (
    enabled: boolean,
    onToggle: () => void,
    onEdit: () => void,
    onDelete: () => void,
  ) =>
    writable ? (
      <span className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </span>
    ) : null;

  const enabledPill = (enabled: boolean) => (
    <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</Badge>
  );

  const boxColumns: Column<Box>[] = [
    { key: 'name', header: 'Name', priority: 'primary', minWidth: 150, cell: (b) => b.name },
    {
      key: 'dims',
      header: 'Inner L\u00d7W\u00d7H (in)',
      minWidth: 150,
      cell: (b) => `${b.innerLengthIn} \u00d7 ${b.innerWidthIn} \u00d7 ${b.innerHeightIn}`,
    },
    { key: 'maxwt', header: 'Max wt (oz)', align: 'right', mono: true, minWidth: 110, cell: (b) => b.maxWeightOz },
    { key: 'tare', header: 'Tare (oz)', align: 'right', mono: true, minWidth: 100, cell: (b) => b.tareOz },
    { key: 'status', header: 'Status', minWidth: 110, cell: (b) => enabledPill(b.enabled) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      minWidth: 230,
      cell: (b) => rowActions(b.enabled, () => toggleBox(b), () => setEditBox(b), () => delBox(b)),
    },
  ];

  const svcColumns: Column<Service>[] = [
    {
      key: 'tier',
      header: 'Tier',
      priority: 'primary',
      minWidth: 110,
      cell: (x) => <span className="capitalize">{x.tier}</span>,
    },
    { key: 'code', header: 'Service code', mono: true, minWidth: 170, cell: (x) => x.carrierServiceCode },
    { key: 'label', header: 'Display label', minWidth: 160, cell: (x) => x.displayLabel },
    { key: 'transit', header: 'Transit', minWidth: 110, cell: (x) => x.transitEstimate },
    { key: 'maxwt', header: 'Max wt', align: 'right', mono: true, minWidth: 90, cell: (x) => x.maxWeightOz },
    { key: 'policy', header: 'Policy', minWidth: 120, cell: (x) => x.selectionPolicy },
    { key: 'status', header: 'Status', minWidth: 110, cell: (x) => enabledPill(x.enabled) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      minWidth: 230,
      cell: (x) => rowActions(x.enabled, () => toggleSvc(x), () => setEditSvc(x), () => delSvc(x)),
    },
  ];

  return (
    <>
      <PageHeader
        title="Shipping Rules"
        subtitle="Box catalog + carrier service mappings for the fulfillment rules engine. Changes take effect at the next rate quote."
        action={
          writable ? (
            tab === 'boxes' ? (
              <Button icon={Plus} onClick={() => setEditBox('new')}>
                Box
              </Button>
            ) : (
              <Button icon={Plus} onClick={() => setEditSvc('new')}>
                Service
              </Button>
            )
          ) : undefined
        }
      />

      <div className="mb-3">
        <Tabs<Tab> active={tab} onChange={setTab} tabs={[{ key: 'boxes', label: 'Boxes', count: boxes.length }, { key: 'services', label: 'Services', count: services.length }]} />
      </div>

      {tab === 'boxes' ? (
        <DataTable
          caption="Box catalog for the fulfillment rules engine"
          mode="scroll"
          columns={boxColumns}
          rows={boxes}
          rowKey={(b) => b.id}
          empty={<EmptyState title="No boxes" hint="Add a box for the rules engine." />}
        />
      ) : (
        <DataTable
          caption="Carrier service mappings"
          mode="scroll"
          columns={svcColumns}
          rows={services}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No services" hint="Map carrier services to tiers." />}
        />
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
    <Drawer open title={box ? 'Edit box' : 'New box'} onOpenChange={(o) => { if (!o) onClose(); }} footer={<Button className="w-full" disabled={!valid} loading={busy} onClick={save}>Save</Button>}>
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Length (in)"><Input value={f.inner_length_in} onChange={(e) => setF({ ...f, inner_length_in: e.target.value })} /></Field>
        <Field label="Width (in)"><Input value={f.inner_width_in} onChange={(e) => setF({ ...f, inner_width_in: e.target.value })} /></Field>
        <Field label="Height (in)"><Input value={f.inner_height_in} onChange={(e) => setF({ ...f, inner_height_in: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Max wt (oz)"><Input value={f.max_weight_oz} onChange={(e) => setF({ ...f, max_weight_oz: e.target.value })} /></Field>
        <Field label="Tare (oz)"><Input value={f.tare_oz} onChange={(e) => setF({ ...f, tare_oz: e.target.value })} /></Field>
        <Field label="Sort"><Input value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></Field>
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
    <Drawer open title={svc ? 'Edit service' : 'New service'} onOpenChange={(o) => { if (!o) onClose(); }} footer={<Button className="w-full" disabled={!valid} loading={busy} onClick={save}>Save</Button>}>
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Tier">
        <select className={inputClass()} value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
          <option value="economy">Economy</option><option value="standard">Standard</option><option value="expedited">Expedited</option>
        </select>
      </Field>
      <Field label="Carrier service code"><Input className="font-mono text-xs" placeholder="usps_ground_advantage" value={f.carrier_service_code} onChange={(e) => setF({ ...f, carrier_service_code: e.target.value })} /></Field>
      <Field label="Display label"><Input placeholder="USPS Ground Advantage" value={f.display_label} onChange={(e) => setF({ ...f, display_label: e.target.value })} /></Field>
      <Field label="Transit estimate"><Input placeholder="2–5 business days" value={f.transit_estimate} onChange={(e) => setF({ ...f, transit_estimate: e.target.value })} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Max wt (oz)"><Input value={f.max_weight_oz} onChange={(e) => setF({ ...f, max_weight_oz: e.target.value })} /></Field>
        <Field label="Policy"><select className={inputClass()} value={f.selection_policy} onChange={(e) => setF({ ...f, selection_policy: e.target.value })}><option value="cheapest">cheapest</option><option value="fixed">fixed</option></select></Field>
        <Field label="Sort"><Input value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
