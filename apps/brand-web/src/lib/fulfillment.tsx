import { Badge, type BadgeTone } from '@ruostack/ui';
import { fulfillmentState, FULFILLMENT_META } from '@ruostack/shared';

/** Maps the shared FULFILLMENT_META tones onto design-system badge tones.
 *  Previously each screen redeclared its own TONE map and FulfillmentBadge;
 *  this is the single definition. */
const BADGE_TONE: Record<string, BadgeTone> = {
  amber: 'warning',
  teal: 'accent',
  success: 'success',
  slate: 'neutral',
  muted: 'neutral',
};

export interface FulfillmentShape {
  status: string;
  blocker: string;
  exported_at: string | null;
}

export function FulfillmentBadge({ order }: { order: FulfillmentShape }) {
  const meta = FULFILLMENT_META[fulfillmentState(order)];
  // Label only — no emoji. Colour is never the sole carrier of meaning.
  return <Badge tone={BADGE_TONE[meta.tone] ?? 'neutral'}>{meta.label}</Badge>;
}
