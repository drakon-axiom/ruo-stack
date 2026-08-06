import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { EmptyState, PageHeader } from '@ruostack/ui';

interface DeadLetter { id: string; source: string; type: string; attempts: number; external_id: string; created_at: string }
interface Drift { kind: string; order_id: string; brand_name: string; detail: string; at: string | null }
interface Report { dead_letter: DeadLetter[]; retryable_count: number; drift: Drift[] }
interface RunResult { retry: { examined: number; healed: number; failed: number; deadLetter: number }; drift: Drift[]; ranAt: string }

const DRIFT_LABEL: Record<string, string> = { shipped_not_captured: 'Shipped — not captured', stale_export: 'Stale export (>24h)' };

export function Exceptions() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'exceptions') : false;
  const [rep, setRep] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function load() { api<Report>('/api/admin/reconciliation').then(setRep); }
  useEffect(load, []);

  async function run() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api<RunResult>('/api/admin/reconciliation/run', { method: 'POST' });
      setMsg(`Healed ${r.retry.healed}, still failing ${r.retry.failed}, dead-letter ${r.retry.deadLetter}, drift ${r.drift.length}.`);
      load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Run failed'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Exceptions & Reconciliation"
        subtitle="Dead-letter webhooks and drift between RUOStack and the external systems. The worker runs automatically; you can also run it on demand."
        action={writable ? <button className="btn" disabled={busy} onClick={run}>{busy ? 'Running…' : 'Run reconciliation'}</button> : undefined}
      />
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
      {msg && <div className="mb-3 rounded-lg border border-line2 bg-card2 px-3 py-2 text-[13px] text-muted">{msg}</div>}

      {!rep ? <div className="card p-10 text-center text-muted">Loading…</div> : (
        <div className="space-y-6">
          {rep.retryable_count > 0 && (
            <div className="rounded-lg border border-amber/40 bg-amber/10 px-4 py-2 text-[13px] text-amber">
              {rep.retryable_count} webhook event{rep.retryable_count > 1 ? 's' : ''} pending retry (will heal on the next run).
            </div>
          )}

          <section>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Drift ({rep.drift.length})</div>
            {rep.drift.length === 0 ? <EmptyState title="No drift" hint="Orders, shipments, and the ledger agree." /> : (
              <div className="card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-3">Kind</th><th className="px-4 py-3">Brand</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Detail</th><th className="px-4 py-3">Since</th>
                  </tr></thead>
                  <tbody>
                    {rep.drift.map((d) => (
                      <tr key={`${d.kind}:${d.order_id}`} className="border-b border-line/60">
                        <td className="px-4 py-3"><span className="pill border-amber/40 bg-amber/10 text-amber">{DRIFT_LABEL[d.kind] ?? d.kind}</span></td>
                        <td className="px-4 py-3 text-text">{d.brand_name}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-muted">{d.order_id.slice(0, 8)}</td>
                        <td className="px-4 py-3 text-muted">{d.detail}</td>
                        <td className="px-4 py-3 text-muted">{d.at ? new Date(d.at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Dead-letter webhooks ({rep.dead_letter.length})</div>
            {rep.dead_letter.length === 0 ? <EmptyState title="None" hint="No webhooks exhausted their retries." /> : (
              <div className="card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-3">Source</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">External ID</th><th className="px-4 py-3">First seen</th>
                  </tr></thead>
                  <tbody>
                    {rep.dead_letter.map((e) => (
                      <tr key={e.id} className="border-b border-line/60">
                        <td className="px-4 py-3 text-text capitalize">{e.source}</td>
                        <td className="px-4 py-3 text-muted">{e.type}</td>
                        <td className="px-4 py-3"><span className="pill border-danger/40 bg-danger/10 text-danger">{e.attempts}</span></td>
                        <td className="px-4 py-3 font-mono text-[11px] text-muted">{e.external_id}</td>
                        <td className="px-4 py-3 text-muted">{new Date(e.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
