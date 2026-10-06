import Stripe from 'stripe';
import { buffer } from 'micro';
import { supabase } from '../lib/supabase.js';
import { generateLicenseKey } from '../lib/generateLicenseKey.js';
import { sendLicenseEmail } from '../lib/sendLicenseEmail.js';
import { config as bizConfig, getProPriceId } from '../lib/config.js';
import { hashKey } from '../lib/licensing.js';

// Stripe webhook: signature-verified, idempotent, full subscription
// lifecycle. Retry-safe: seen event ids are no-ops, and the checkout
// handler skips license creation when the subscription is already known.
// Raw license keys are never logged.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: { bodyParser: false }
};

function graceUntil(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function markPastDue(subscriptionId, customerId) {
  // Enter grace once: never shorten an existing grace window.
  const { data } = await supabase
    .from('licenses')
    .select('id, grace_until')
    .eq('stripe_subscription_id', subscriptionId)
    .single();
  if (!data) return;
  if (data.grace_until && new Date(data.grace_until) > new Date()) return;
  await supabase.from('licenses').update({
    status: 'past_due',
    grace_until: graceUntil(bizConfig.GRACE_DAYS),
    updated_at: new Date().toISOString(),
  }).eq('id', data.id);
}

async function subscriptionPricesMatch(subscription) {
  const expected = getProPriceId();
  if (!expected) {
    console.log('webhook: STRIPE_PRO_PRICE_ID unset, skipping price verification');
    return true;
  }
  try {
    const sub = typeof subscription === 'string'
      ? await stripe.subscriptions.retrieve(subscription)
      : subscription;
    const ids = (sub.items?.data || []).map((i) => i.price?.id).filter(Boolean);
    return ids.includes(expected);
  } catch (err) {
    console.error('webhook: price verification lookup failed');
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: already-seen event ids are safe no-ops.
  const { data: seen } = await supabase
    .from('stripe_events')
    .select('event_id')
    .eq('event_id', event.id)
    .single();
  if (seen) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Single-plan product: every completed checkout grants Pro, but only
        // if the subscription references the configured Pro Price ID.
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        if (!email) {
          console.error('Webhook: checkout.session.completed with no customer email, skipping license');
          break;
        }
        if (session.subscription && !(await subscriptionPricesMatch(session.subscription))) {
          console.error('Webhook: subscription price mismatch, skipping license');
          break;
        }
        // Idempotent creation: same subscription already fulfilled → skip.
        if (session.subscription) {
          const { data: existing } = await supabase
            .from('licenses')
            .select('id')
            .eq('stripe_subscription_id', session.subscription)
            .single();
          if (existing) break;
        }
        const licenseKey = generateLicenseKey();

        await supabase.from('licenses').upsert({
          email,
          license_key: licenseKey,
          key_hash: hashKey(licenseKey),
          plan: 'pro',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          status: 'active',
          grace_until: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

        console.log(`License issued for ${email}`);
        await sendLicenseEmail(email, licenseKey);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        if (sub.status === 'active' || sub.status === 'trialing') {
          await supabase.from('licenses')
            .update({ status: 'active', grace_until: null, updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', sub.id);
        } else if (sub.status === 'past_due') {
          await markPastDue(sub.id, sub.customer);
        } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
          await supabase.from('licenses')
            .update({ plan: 'free', status: 'canceled', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', sub.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('licenses')
          .update({ plan: 'free', status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) await markPastDue(invoice.subscription, invoice.customer);
        break;
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        if (session.subscription) await markPastDue(session.subscription, session.customer);
        else console.error('Webhook: async payment failed with no subscription reference');
        break;
      }
    }

    await supabase.from('stripe_events').insert({
      event_id: event.id,
      type: event.type,
      result: 'processed',
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
