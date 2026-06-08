// ============================================================================
// PEGASUS NETWORK — Verify Checkout Session (webhook fallback)
// netlify/functions/verify-checkout-session.js
//
// Secure backend activation path used when the Stripe webhook is delayed,
// misconfigured, or not yet firing. Does NOT trust the URL alone:
//   1. Validates the caller's Supabase auth token -> real uid
//   2. Retrieves the Stripe Checkout Session server-side
//   3. Confirms the session's subscription belongs to THIS uid
//      (session.metadata.user_id === uid)
//   4. Confirms the subscription is paid / trialing
//   5. Upserts subscriptions + memberships with the service role
//
// Client POSTs: { session_id }  with header Authorization: Bearer <supabase jwt>
// Returns:      { activated: bool, tier, status, reason? }
// ============================================================================
"use strict";

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const env = process.env;
function priceToPlan(priceId) {
  const map = {
    [env.STRIPE_PRICE_STARTER_MONTHLY || env.STRIPE_STARTER_MONTHLY]: ["starter", "monthly"],
    [env.STRIPE_PRICE_STARTER_ANNUAL  || env.STRIPE_STARTER_ANNUAL]:  ["starter", "annual"],
    [env.STRIPE_PRICE_PRO_MONTHLY     || env.STRIPE_PROFESSIONAL_MONTHLY]: ["pro", "monthly"],
    [env.STRIPE_PRICE_PRO_ANNUAL      || env.STRIPE_PROFESSIONAL_ANNUAL]:  ["pro", "annual"],
    [env.STRIPE_PRICE_GOLD_MONTHLY    || env.STRIPE_GOLD_MONTHLY]: ["gold", "monthly"],
    [env.STRIPE_PRICE_GOLD_ANNUAL     || env.STRIPE_GOLD_ANNUAL]:  ["gold", "annual"],
  };
  return map[priceId] || [null, null];
}

function mapStatus(s) {
  if (s === "trialing") return "trialing";
  if (s === "active") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "incomplete";
}

async function upsert(table, fullRow) {
  // Self-healing: the live table schema may be missing optional columns
  // (created by an older migration). Strip any column the schema rejects and
  // retry, never dropping the essentials needed for activation.
  const ESSENTIAL = ["user_id", "tier", "status"];
  let row = Object.assign({}, fullRow);
  let dropped = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await supabase.from(table).upsert(row, { onConflict: "user_id" });
    if (!error) {
      if (dropped.length) console.log("[verify][upsert][" + table + "] OK (dropped unknown cols: " + dropped.join(",") + ")");
      else console.log("[verify][upsert][" + table + "] OK user=" + row.user_id + " tier=" + row.tier + " status=" + row.status);
      return { ok: true, error: null };
    }
    const m = error.message && error.message.match(/Could not find the '([^']+)' column/);
    if (m && ESSENTIAL.indexOf(m[1]) === -1 && Object.prototype.hasOwnProperty.call(row, m[1])) {
      delete row[m[1]];
      dropped.push(m[1]);
      continue; // retry without the unknown column
    }
    console.error("[verify][upsert][" + table + "] ERROR:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "too many schema retries" };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body || "{}");
    const sessionId = body.session_id;
    if (!sessionId) return { statusCode: 400, body: JSON.stringify({ activated: false, reason: "missing session_id" }) };

    // 1. Validate the caller's Supabase auth token → real uid (never trust URL alone)
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return { statusCode: 401, body: JSON.stringify({ activated: false, reason: "missing auth token" }) };

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const uid = userData && userData.user && userData.user.id;
    if (userErr || !uid) {
      console.warn("[verify] auth failed:", userErr && userErr.message);
      return { statusCode: 401, body: JSON.stringify({ activated: false, reason: "invalid auth token" }) };
    }

    // 2. Retrieve the Stripe Checkout Session
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (!session) return { statusCode: 404, body: JSON.stringify({ activated: false, reason: "session not found" }) };

    // 3. SECURITY: the session's metadata.user_id must match the authenticated uid
    const sessionUserId = session.metadata && session.metadata.user_id;
    if (sessionUserId && sessionUserId !== uid) {
      console.warn("[verify] uid mismatch — session.user_id=" + sessionUserId + " token.uid=" + uid);
      return { statusCode: 403, body: JSON.stringify({ activated: false, reason: "session does not belong to user" }) };
    }

    // 4. Resolve the subscription + status
    let sub = session.subscription;
    if (typeof sub === "string") sub = await stripe.subscriptions.retrieve(sub);
    if (!sub) {
      console.log("[verify] no subscription on session yet:", sessionId);
      return { statusCode: 200, body: JSON.stringify({ activated: false, reason: "subscription not ready" }) };
    }

    const status = mapStatus(sub.status);
    const paidOrTrial = ["active", "trialing"].includes(status);
    if (!paidOrTrial) {
      console.log("[verify] subscription not active/trialing:", sub.status);
      return { statusCode: 200, body: JSON.stringify({ activated: false, reason: "status=" + sub.status }) };
    }

    // 5. Determine tier (price map → session metadata override)
    const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
    let [tier, cycle] = priceToPlan(priceId);
    if (session.metadata && session.metadata.tier) tier = session.metadata.tier;
    if (session.metadata && session.metadata.cycle) cycle = session.metadata.cycle;
    if (!tier) tier = "starter";

    // Common columns present on BOTH tables
    const base = {
      user_id: uid, tier, status,
      billing_cycle: cycle || "monthly",
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
    };
    // subscriptions has exactly the base columns
    const subRow = base;
    // memberships additionally has plan + billing (legacy aliases)
    const memRow = Object.assign({}, base, { plan: tier, billing: cycle || "monthly" });

    console.log("[verify] activating user=" + uid + " tier=" + tier + " status=" + status + " (fallback path)");
    const rSub = await upsert("subscriptions", subRow);
    const rMem = await upsert("memberships", memRow);
    const activated = (rSub.ok || rMem.ok);

    // Also ensure customer metadata is set for future webhook calls
    if (sub.customer) {
      stripe.customers.update(sub.customer, { metadata: { user_id: uid } }).catch(() => {});
    }

    // Surface a clear reason when nothing was written (e.g. tables missing)
    let reason = null;
    if (!activated) {
      reason = (rSub.error || rMem.error || "write failed");
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        activated, tier, status, reason,
        wrote: { subscriptions: rSub.ok, memberships: rMem.ok },
        errors: { subscriptions: rSub.error, memberships: rMem.error },
      }),
    };
  } catch (err) {
    console.error("[verify] ERROR:", err.message);
    return { statusCode: 500, body: JSON.stringify({ activated: false, reason: err.message }) };
  }
};
