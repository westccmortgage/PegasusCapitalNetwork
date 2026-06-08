// ============================================================================
// PEGASUS NETWORK — Stripe Customer Self-Service Portal
// netlify/functions/create-portal-session.js
//
// Returns a hosted Stripe Billing Portal URL where the member can:
//   - update payment method
//   - switch / upgrade / downgrade plan   (enable "plan switching" in Portal config)
//   - cancel subscription
//   - view & download invoices
//
// Client POSTs: { userId }
// Returns:      { url }  on success
//               { error:'no_customer' }  if the user has never subscribed
//                                         (client should route to pricing/checkout)
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//
// One-time setup in Stripe: Dashboard > Settings > Billing > Customer portal —
// turn ON "Customers can switch plans" and add your 3 products so plan changes,
// proration, and cancellations are all handled by Stripe (your webhook then
// syncs the new tier back to Supabase automatically).
// ============================================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId } = body;
    if (!userId) return { statusCode: 400, body: JSON.stringify({ error: 'missing_user' }) };

    const { data, error } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    if (!data || !data.stripe_customer_id) {
      // No Stripe customer yet (e.g. Starter who never checked out).
      return { statusCode: 409, body: JSON.stringify({ error: 'no_customer' }) };
    }

    // Return to the SAME domain the user started on (prevents cross-domain
    // session loss). Canonical domain is the default.
    const ALLOWED_ORIGINS = [
      'https://pegasuscapitalnetwork.com',
      'https://www.pegasuscapitalnetwork.com',
      'https://pegasuslendersgroup.com',
      'https://www.pegasuslendersgroup.com',
      'https://pegasuslendersgroup.netlify.app',
    ];
    let site = process.env.SITE_URL || 'https://pegasuscapitalnetwork.com';
    if (body.origin && ALLOWED_ORIGINS.includes(body.origin)) site = body.origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${site}/membership.html`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Portal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
