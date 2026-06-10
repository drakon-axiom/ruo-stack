// Creates a Stripe Checkout session to top up the seller's wallet.
// The amount is validated server-side. The wallet is NOT credited here — only
// the stripe-webhook (on checkout.session.completed) credits it, so a user
// who abandons checkout never gets funds.
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/client.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const MIN_DEPOSIT = 1;
const MAX_DEPOSIT = 50000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await requireUser(req);
    const { amount } = await req.json();

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < MIN_DEPOSIT || amt > MAX_DEPOSIT) {
      return json({ error: `amount must be between $${MIN_DEPOSIT} and $${MAX_DEPOSIT}` }, 400);
    }

    const admin = adminClient();

    // record a pending deposit we can reconcile against in the webhook
    const { data: deposit, error: depErr } = await admin
      .from('pending_deposits')
      .insert({ user_id: userId, amount: amt, status: 'pending' })
      .select('id')
      .single();
    if (depErr) throw depErr;

    const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:3900';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${siteUrl}/dashboard?topup=success`,
      cancel_url: `${siteUrl}/checkout?topup=cancelled`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(amt * 100),
            product_data: { name: 'Wallet top-up' },
          },
        },
      ],
      // tie the session back to the deposit + user for the webhook
      client_reference_id: deposit.id,
      metadata: { deposit_id: deposit.id, user_id: userId },
    });

    await admin
      .from('pending_deposits')
      .update({ stripe_session_id: session.id, invoice_url: session.url })
      .eq('id', deposit.id);

    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
