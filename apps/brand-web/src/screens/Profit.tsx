import { useEffect, useMemo, useState } from 'react';
import { FLAT_FALLBACK } from '@ruostack/shared';
import {
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Select,
  cn,
  type Column,
} from '@ruostack/ui';
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
interface PlanRow {
  key: string;
  name: string;
  price_cents: number;
}
interface Sub {
  current_plan: string;
  plans: PlanRow[];
}

interface Projection {
  volume: number;
  walletLoad: number;
  gross: number;
  net: number;
  isBreakEven: boolean;
}

// Per-order + projected economics. Pure client-side: cost = wholesale (+ shipping if
// you absorb it); revenue = your retail (+ shipping if you bill the customer for it).
export function Profit() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);
  const [selected, setSelected] = useState('');
  const [retail, setRetail] = useState(''); // dollars string, editable
  const [inclShip, setInclShip] = useState(true); // shipping is part of my cost
  const [chargeShip, setChargeShip] = useState(true); // I bill the customer for shipping
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ products: Product[] }>('/api/brand/catalog').then((r) => {
      setProducts(r.products);
      if (r.products[0]) {
        setSelected(r.products[0].id);
        setRetail((r.products[0].retail_cents / 100).toFixed(2));
      }
      setLoading(false);
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
        <PageHeader title="Profit Calculator" />
        <EmptyState
          title={loading ? 'Loading…' : 'No published products to model yet'}
          hint={loading ? undefined : 'Products appear here once the operator publishes them.'}
        />
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

  const rows: Projection[] = VOLUMES.map((v) => {
    const gross = profitPerOrder * v;
    return {
      volume: v,
      walletLoad: (wholesale + SHIP) * v, // what you must keep funded
      gross,
      net: gross - membershipMonthly,
      isBreakEven: v === breakEvenTier,
    };
  });

  const columns: Column<Projection>[] = [
    {
      key: 'volume',
      header: 'Orders / mo',
      priority: 'primary',
      cell: (r) => (
        <span className="tabular-nums">
          {r.volume}
          {r.isBreakEven && (
            <span className="ml-2 text-2xs uppercase text-accent">break-even</span>
          )}
        </span>
      ),
    },
    {
      key: 'wallet',
      header: 'Wallet load',
      align: 'right',
      mono: true,
      cell: (r) => dollars(r.walletLoad),
    },
    { key: 'gross', header: 'Gross profit', align: 'right', mono: true, cell: (r) => dollars(r.gross) },
    {
      key: 'membership',
      header: 'Membership',
      align: 'right',
      mono: true,
      cell: () => (membershipMonthly ? `-${dollars(membershipMonthly)}` : '—'),
    },
    {
      key: 'net',
      header: 'Net profit',
      align: 'right',
      mono: true,
      cell: (r) => (
        <span className={cn('font-semibold', r.net >= 0 ? 'text-success' : 'text-danger')}>
          {dollars(r.net)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Profit Calculator"
        subtitle={`Model your margin per order and project monthly profit by volume. Fulfillment is a flat ${dollars(SHIP)} (${FLAT_FALLBACK.carrier} Ground Advantage).`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Inputs */}
        <Card className="p-5">
          <Field label="Product" htmlFor="p-product">
            <Select
              id="p-product"
              value={selected}
              onValueChange={pick}
              options={products.map((p) => ({
                value: p.id,
                label: `${p.name}${p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}`,
              }))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Your cost (wholesale)">
              <div className="min-h-11 rounded-[10px] border border-line bg-surface-3 px-3 py-2 font-mono text-sm tabular-nums text-content-muted md:min-h-0">
                {dollars(wholesale)}
              </div>
            </Field>
            <Field label="Your retail price" htmlFor="p-retail">
              <div className="flex items-center gap-1">
                <span className="text-content-faint">$</span>
                <Input
                  id="p-retail"
                  inputMode="decimal"
                  value={retail}
                  onChange={(e) => setRetail(e.target.value)}
                />
              </div>
            </Field>
          </div>

          <div className="space-y-2">
            <Checkbox
              checked={inclShip}
              onCheckedChange={setInclShip}
              label={`Include shipping in my cost (${dollars(SHIP)})`}
            />
            <Checkbox
              checked={chargeShip}
              onCheckedChange={setChargeShip}
              label={`Charge the customer for shipping (${dollars(SHIP)})`}
            />
          </div>
        </Card>

        {/* Per-order summary */}
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">Per order</h2>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-content-muted">
              <span>Revenue</span>
              <span className="font-mono tabular-nums">{dollars(revenuePerOrder)}</span>
            </div>
            <div className="flex justify-between text-content-muted">
              <span>Cost</span>
              <span className="font-mono tabular-nums">{dollars(costPerOrder)}</span>
            </div>
            <div className="my-2 border-t border-line-subtle" />
            <div className="flex justify-between text-lg font-semibold">
              <span>Profit</span>
              <span
                className={cn(
                  'font-mono tabular-nums',
                  profitPerOrder >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {dollars(profitPerOrder)}
              </span>
            </div>
            <div className="flex justify-between text-content-muted">
              <span>Margin</span>
              <span className="font-mono tabular-nums">{marginPct}%</span>
            </div>
          </div>

          {profitPerOrder <= 0 ? (
            <div className="mt-3">
              <InlineAlert tone="warning">
                This product loses money at the current retail price. Raise your retail or charge for
                shipping.
              </InlineAlert>
            </div>
          ) : breakEvenUnits !== null && membershipMonthly > 0 ? (
            <div className="mt-3">
              <InlineAlert tone="accent">
                ~{breakEvenUnits} order{breakEvenUnits > 1 ? 's' : ''}/month covers your{' '}
                {dollars(membershipMonthly)} membership.
              </InlineAlert>
            </div>
          ) : null}
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-2xs uppercase tracking-[0.12em] text-content-faint">
        Monthly projection
      </h2>
      <DataTable
        caption="Projected monthly profit by order volume"
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.volume)}
      />

      <p className="mt-3 text-2xs text-content-faint">
        Wallet load is the prepaid balance to keep on hand (wholesale + fulfillment per order). Net
        profit subtracts your monthly membership. Research use only.
      </p>
    </>
  );
}
