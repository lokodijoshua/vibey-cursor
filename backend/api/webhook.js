import Stripe from 'stripe';
import { buffer } from 'micro';
import { supabase } from '../lib/supabase.js';
import { generateLicenseKey } from '../lib/generateLicenseKey.js';
import { sendLicenseEmail } from '../lib/sendLicenseEmail.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: { bodyParser: false }
};

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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Single-plan product: every completed checkout (Payment Link or
        // Checkout Session) grants Pro. No plan metadata needed.
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        if (!email) {
          console.error('Webhook: checkout.session.completed with no customer email, skipping license');
          break;
        }
        const plan = 'pro';
        const licenseKey = generateLicenseKey();

        await supabase.from('licenses').upsert({
          email,
          license_key: licenseKey,
          plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          status: 'active',
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

        console.log(`License issued for ${email}: ${licenseKey}`);
        await sendLicenseEmail(email, licenseKey);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await supabase.from('licenses')
          .update({ status: sub.status === 'active' ? 'active' : 'past_due', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('licenses')
          .update({ plan: 'free', status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        break;
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}