import type { ShipTo } from '../Orders.js';

/** The API supplies safe integer cents; avoid rounding while converting to dollars. */
export const dollars = (c: number) => {
  const cents = BigInt(c);
  const magnitude = cents < 0n ? -cents : cents;
  return `$${cents < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
};

export interface OrderRow {
  id: string;
  status: string;
  blocker: string;
  wallet_charge_cents: number;
  tracking_number: string | null;
  exported_at: string | null;
  created_at: string;
}

export interface Customer {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string;
  state: string;
  country: string;
  orders: number;
  spend_cents: number;
  first_order: string;
  last_order: string;
  last_status: string;
  last_blocker: string;
  last_exported_at: string | null;
  /** Null when we hold no complete address for them — see `shipToFrom` on the API. */
  ship_to: ShipTo | null;
  order_list: OrderRow[];
}

export interface Totals {
  customers: number;
  orders: number;
  spend_cents: number;
  truncated: boolean;
}

export const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });


export interface HistoryCursor { created_at: string; id: string }
export interface HistoryResponse {
  customers: Customer[];
  totals: Totals;
  page: { has_more: boolean; next_cursor: HistoryCursor | null };
}
