import { Badge, type BadgeTone } from './Badge.js';

/* Covers every status string the two apps render today. Unknown values fall
 * back to neutral rather than throwing, so a new backend status degrades to a
 * readable pill instead of an unstyled one. */
const TONE: Record<string, BadgeTone> = {
  in_stock: 'success',
  active: 'success',
  delivered: 'success',
  shipped: 'success',
  approved: 'success',
  paid: 'success',
  resolved: 'success',

  soon: 'warning',
  pending: 'warning',
  processing: 'warning',
  awaiting_funds: 'warning',
  open: 'warning',

  ready_for_fulfillment: 'accent',

  out_of_stock: 'danger',
  suspended: 'danger',
  cancelled: 'danger',
  rejected: 'danger',
  failed: 'danger',
};

export function StatusPill({ value }: { value: string }) {
  return <Badge tone={TONE[value] ?? 'neutral'}>{value.replace(/_/g, ' ')}</Badge>;
}
