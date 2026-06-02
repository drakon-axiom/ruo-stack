// Stripe webhook — the ONLY place wallet credits and subscription status are
// written. Verifies the signature, then dispatches on event type. Crediting is
// idempotent via credit_deposit() (keyed on pending_deposits.status).
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { adminClient } from '../_shared/client.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret);
  } catch (e) {
    return new Response(`Webhook signature verification failed: ${e}`, { status: 400 });
  }

  const admin = adminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const depositId = session.metadata?.deposit_id;
        if (depositId && session.payment_status === 'paid') {
          // credit_deposit is idempotent — safe even if Stripe retries.
          await admin.rpc('credit_deposit', { p_deposit_id: depositId });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const { data: profile } = await admin
          .from('profiles')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();
        if (profile) {
          const status =
            sub.status === 'active' || sub.status === 'trialing'
              ? sub.status
              : sub.status === 'past_due'
                ? 'past_due'
                : 'canceled';
          await admin
            .from('subscriptions')
            .update({
              stripe_subscription_id: sub.id,
              status,
              current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
              cancel_at_period_end: sub.cancel_at_period_end,
            })
            .eq('user_id', profile.user_id);
          await admin
            .from('profiles')
            .update({ subscription_status: status })
            .eq('user_id', profile.user_id);
        }
        break;
      }
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('webhook handler error', e);
    return new Response(`handler error: ${e}`, { status: 500 });
  }
});
