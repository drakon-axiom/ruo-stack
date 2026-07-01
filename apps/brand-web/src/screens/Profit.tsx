import { useEffect, useMemo, useState } from 'react';
import { FLAT_FALLBACK } from '@ruostack/shared';
import { api } from '../lib/api.js';

const dollars = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const SHIP = FLAT_FALLBACK.amountCents; // $12.99 flat fulfillment cost
const VOLUMES = [10, 25, 50, 100, 250, 500];

interface Product {
  id: string;
  name: string;
  dose?: string | null;
  unit?: string | null;
  wholesale_cents: number;
  retail_cents: number;
}
interface PlanRow { key: string; name: string; price_cents: number }
interface Sub { current_plan: string; plans: PlanRow[] }

// Per-order + projected economics. Pure client-side: cost = wholesale (+ shipping if
// you absorb it); revenue = your retail (+ shipping if you bill the customer for it).
export function Profit() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);
  const [selected, setSelected] = useState('');
  const [retail, setRetail] = useState(''); // dollars string, editable
  const [inclShip, setInclShip] = useState(true); // shipping is part of my cost
  const [chargeShip, setChargeShip] = useState(true); // I bill the customer for shipping

  useEffect(() => {
    api<{ products: Product[] }>('/api/brand/catalog').then((r) => {
      setProducts(r.products);
      if (r.products[0]) {
        setSelected(r.products[0].id);
        setRetail((r.products[0].retail_cents / 100).toFixed(2));
      }
    });
    api<Sub>('/api/brand/subscription').then(setSub);
  }, []);

  const product = products.find((p) => p.id === selected) ?? null;

  function pick(id: string) {
    setSelected(id);
    const p = products.find((x) => x.id === id);
    if (p) setRetail((p.retail_cents / 100).toFixed(2));
  }

  const retailCents = Math.max(0, Math.round(parseFloat(retail || '0') * 100));
  const membershipMonthly = useMemo(() => {
    if (!sub) return 0;
    return sub.plans.find((p) => p.key === sub.current_plan)?.price_cents ?? 0;
  }, [sub]);

  if (!product) {
    return (
      <>
        <h1 className="mb-1 text-[23px] font-bold">Profit Calculator</h1>
        <div className="surface mt-4 p-10 text-center text-muted">
          {products.length === 0 ? 'No published products to model yet.' : 'Loading…'}
        </div>
      </>
    );
  }

  const wholesale = product.wholesale_cents;
  const costPerOrder = wholesale + (inclShip ? SHIP : 0);
  const revenuePerOrder = retailCents + (chargeShip ? SHIP : 0);
  const profitPerOrder = revenuePerOrder - costPerOrder;
  const marginPct = revenuePerOrder > 0 ? Math.round((profitPerOrder / revenuePerOrder) * 100) : 0;
  // Break-even units against the monthly membership (orders to cover the plan fee).
  const breakEvenUnits = profitPerOrder > 0 ? Math.ceil(membershipMonthly / profitPerOrder) : null;
  // First volume tier in the table that clears the membership (for row highlight).
  const breakEvenTier = VOLUMES.find((v) => profitPerOrder * v - membershipMonthly >= 0) ?? null;

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Profit Calculator</h1>
      <p className="mb-5 text-[13px] text-muted">
        Model your margin per order and project monthly profit by volume. Fulfillment is a flat {dollars(SHIP)} ({FLAT_FALLBACK.carrier} Ground Advantage).
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Inputs */}
        <div className="surface p-5">
          <span className="label mb-1 block">Product</span>
          <select className="app-input mb-3" value={selected} onChange={(e) => pick(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}</option>
            ))}
          </select>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <span className="label mb-1 block">Your cost (wholesale)</span>
              <div className="app-input bg-card2 text-muted">{dollars(wholesale)}</div>
            </div>
            <div>
              <span className="label mb-1 block">Your retail price</span>
              <div className="flex items-center gap-1">
                <span className="text-faint">$</span>
                <input
                  className="app-input"
                  inputMode="decimal"
                  value={retail}
                  onChange={(e) => setRetail(e.target.value)}
                />
              </div>
            </div>
          </div>

          <label className="mb-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={inclShip} onChange={(e) => setInclShip(e.target.checked)} />
            <span>Include shipping in my cost ({dollars(SHIP)})</span>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={chargeShip} onChange={(e) => setChargeShip(e.target.checked)} />
            <span>Charge the customer for shipping ({dollars(SHIP)})</span>
          </label>
        </div>

        {/* Per-order summary */}
        <div className="surface p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Per order</h2>
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between text-muted"><span>Revenue</span><span>{dollars(revenuePerOrder)}</span></div>
            <div className="flex justify-between text-muted"><span>Cost</span><span>{dollars(costPerOrder)}</span></div>
            <div className="my-2 border-t border-lline dark:border-line" />
            <div className="flex justify-between text-[15px] font-semibold">
              <span>Profit</span>
              <span className={profitPerOrder >= 0 ? 'text-success' : 'text-danger'}>{dollars(profitPerOrder)}</span>
            </div>
            <div className="flex justify-between text-muted"><span>Margin</span><span>{marginPct}%</span></div>
          </div>
          {profitPerOrder <= 0 ? (
            <div className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
              This product loses money at the current retail price. Raise your retail or charge for shipping.
            </div>
          ) : breakEvenUnits !== null && membershipMonthly > 0 ? (
            <div className="mt-3 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-[12px] text-teal">
              ~{breakEvenUnits} order{breakEvenUnits > 1 ? 's' : ''}/month covers your {dollars(membershipMonthly)} membership.
            </div>
          ) : null}
        </div>
      </div>

      {/* Projections by volume */}
      <h2 className="mb-2 mt-6 text-[13px] uppercase tracking-[0.12em] text-faint">Monthly projection</h2>
      <div className="surface overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
              <th className="px-4 py-3">Orders / mo</th>
              <th className="px-4 py-3">Wallet load</th>
              <th className="px-4 py-3">Gross profit</th>
              <th className="px-4 py-3">Membership</th>
              <th className="px-4 py-3 text-right">Net profit</th>
            </tr>
          </thead>
          <tbody>
            {VOLUMES.map((v) => {
              const walletLoad = (wholesale + SHIP) * v; // what you must keep funded
              const gross = profitPerOrder * v;
              const net = gross - membershipMonthly;
              return (
                <tr
                  key={v}
                  className={`border-b border-lline/60 dark:border-line/60 ${v === breakEvenTier ? 'bg-teal/5' : ''}`}
                >
                  <td className="px-4 py-3 font-medium">{v}{v === breakEvenTier ? <span className="ml-2 text-[10px] uppercase text-teal">break-even</span> : ''}</td>
                  <td className="px-4 py-3 text-muted">{dollars(walletLoad)}</td>
                  <td className="px-4 py-3">{dollars(gross)}</td>
                  <td className="px-4 py-3 text-muted">{membershipMonthly ? `-${dollars(membershipMonthly)}` : '—'}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${net >= 0 ? 'text-success' : 'text-danger'}`}>{dollars(net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-faint">
        Wallet load is the prepaid balance to keep on hand (wholesale + fulfillment per order). Net profit subtracts your monthly membership. Research use only.
      </p>
    </>
  );
}
