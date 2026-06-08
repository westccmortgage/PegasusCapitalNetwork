// ============================================================================
// PEGASUS NETWORK — Create Stripe Checkout Session (subscription + trial)
// netlify/functions/create-checkout-session.js
//
// Client POSTs: { tier, cycle, userId, email }
// Returns:      { url }  -> redirect the browser there.
//
// Required env vars: STRIPE_SECRET_KEY, SITE_URL, and the 6 STRIPE_PRICE_* vars.
// ============================================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Accepts BOTH the new STRIPE_PRICE_* names and the v68 production names
// (STRIPE_STARTER_MONTHLY / STRIPE_PROFESSIONAL_* / STRIPE_GOLD_*). Whichever
// is set in Netlify wins, so the existing live Stripe products keep working.
const env = process.env;
const PRICE = {
  starter: { monthly: env.STRIPE_PRICE_STARTER_MONTHLY || env.STRIPE_STARTER_MONTHLY,
             annual:  env.STRIPE_PRICE_STARTER_ANNUAL  || env.STRIPE_STARTER_ANNUAL },
  pro:     { monthly: env.STRIPE_PRICE_PRO_MONTHLY || env.STRIPE_PROFESSIONAL_MONTHLY,
             annual:  env.STRIPE_PRICE_PRO_ANNUAL  || env.STRIPE_PROFESSIONAL_ANNUAL },
  gold:    { monthly: env.STRIPE_PRICE_GOLD_MONTHLY || env.STRIPE_GOLD_MONTHLY,
             annual:  env.STRIPE_PRICE_GOLD_ANNUAL  || env.STRIPE_GOLD_ANNUAL },
};
// canonical internal tier ids; map legacy 'professional' -> 'pro'
const TIER = { starter:'starter', pro:'pro', professional:'pro', gold:'gold' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    // v69 sends {tier,cycle}; v68 sends {plan,billing} — accept both
    const tier  = TIER[body.tier || body.plan] || null;
    const cycle = body.billing || body.cycle || 'monthly';
    const { userId, email } = body;
    const price = tier && PRICE[tier]?.[cycle];
    if (!price) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid or unconfigured tier/cycle' }) };
    if (!userId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) };

    // Reuse an existing customer for this user if one exists, else create.
    let customerId;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customerId = existing.data[0]?.id;
    }
    if (!customerId) {
      // Create new customer with user_id in metadata
      const c = await stripe.customers.create({ email, metadata: { user_id: userId } });
      customerId = c.id;
      console.log('[checkout] created customer:', customerId, 'for user:', userId);
    } else {
      // Existing customer — ensure user_id metadata is set (may be missing for old accounts)
      await stripe.customers.update(customerId, { metadata: { user_id: userId } })
        .catch(e => console.warn('[checkout] metadata update failed:', e.message));
      console.log('[checkout] reusing customer:', customerId, 'for user:', userId);
    }

    // Return to the SAME domain the user started on — critical for multi-domain
    // setups. A cross-domain redirect loses the browser session and drops the
    // user into demo mode. Validate the passed origin against an allowlist.
    const ALLOWED_ORIGINS = [
      'https://pegasuslendersgroup.com',
      'https://www.pegasuslendersgroup.com',
      'https://pegasuscapitalnetwork.com',
      'https://www.pegasuscapitalnetwork.com',
      'https://pegasuslendersgroup.netlify.app',
    ];
    let site = process.env.SITE_URL || 'https://pegasuscapitalnetwork.com';
    if (body.origin && ALLOWED_ORIGINS.includes(body.origin)) {
      site = body.origin; // honor the caller's domain when it's a known one
    }
    console.log('[checkout] redirect base:', site);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        metadata: { user_id: userId, tier, cycle },
      },
      metadata: { user_id: userId, tier, cycle },
      allow_promotion_codes: true,
      success_url: `${site}/dashboard.html?upgrade=success&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/membership.html?upgrade=cancelled`,
    });

    console.log('[checkout] session created:', JSON.stringify({ session_id: session.id, user_id: userId, tier: tier, cycle: cycle }));
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Checkout error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
