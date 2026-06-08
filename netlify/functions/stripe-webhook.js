// ============================================================================
// PEGASUS NETWORK — Stripe Webhook → Supabase Billing Sync  (v2 — fixed)
// netlify/functions/stripe-webhook.js
//
// v2 fixes:
//  - resolveUserId: 4-strategy lookup (sub metadata → customer metadata → email → DB)
//  - writes to BOTH subscriptions AND memberships tables
//  - structured console logging for Netlify function logs
//  - always merges checkout metadata onto subscription before sync
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
    [env.STRIPE_PRICE_STARTER_MONTHLY || env.STRIPE_STARTER_MONTHLY]: ["starter","monthly"],
    [env.STRIPE_PRICE_STARTER_ANNUAL  || env.STRIPE_STARTER_ANNUAL]:  ["starter","annual"],
    [env.STRIPE_PRICE_PRO_MONTHLY     || env.STRIPE_PROFESSIONAL_MONTHLY]: ["pro","monthly"],
    [env.STRIPE_PRICE_PRO_ANNUAL      || env.STRIPE_PROFESSIONAL_ANNUAL]:  ["pro","annual"],
    [env.STRIPE_PRICE_GOLD_MONTHLY    || env.STRIPE_GOLD_MONTHLY]: ["gold","monthly"],
    [env.STRIPE_PRICE_GOLD_ANNUAL     || env.STRIPE_GOLD_ANNUAL]:  ["gold","annual"],
  };
  return map[priceId] || [null, null];
}

function mapStatus(s) {
  if (s === "trialing") return "trialing";
  if (s === "active")   return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "incomplete";
}

async function resolveUserId(sub) {
  const tag = "[resolveUserId][sub=" + sub.id + "]";

  // 1. Subscription metadata
  if (sub.metadata && sub.metadata.user_id) {
    console.log(tag, "via sub.metadata:", sub.metadata.user_id);
    return sub.metadata.user_id;
  }

  // 2. Customer metadata + email fallback
  try {
    const cust = await stripe.customers.retrieve(sub.customer);
    if (cust && !cust.deleted) {
      if (cust.metadata && cust.metadata.user_id) {
        console.log(tag, "via customer.metadata:", cust.metadata.user_id);
        return cust.metadata.user_id;
      }
      if (cust.email) {
        const { data: p } = await supabase.from("profiles").select("id").eq("email", cust.email).maybeSingle();
        if (p && p.id) {
          console.log(tag, "via email lookup:", p.id);
          await stripe.customers.update(sub.customer, { metadata: { user_id: p.id } }).catch(() => {});
          return p.id;
        }
      }
    }
  } catch (e) { console.warn(tag, "customer lookup:", e.message); }

  // 3. subscriptions table by customer_id
  try {
    const { data } = await supabase.from("subscriptions").select("user_id").eq("stripe_customer_id", sub.customer).maybeSingle();
    if (data && data.user_id) { console.log(tag, "via subscriptions table:", data.user_id); return data.user_id; }
  } catch (e) { console.warn(tag, "sub table lookup:", e.message); }

  console.error(tag, "FAILED — no user_id for customer:", sub.customer);
  return null;
}

async function upsert(table, fullRow) {
  const ESSENTIAL = ["user_id", "tier", "status"];
  let row = Object.assign({}, fullRow);
  let dropped = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await supabase.from(table).upsert(row, { onConflict: "user_id" });
    if (!error) {
      console.log("[upsert][" + table + "] OK user=" + row.user_id + " tier=" + row.tier + " status=" + row.status + (dropped.length ? " (dropped: " + dropped.join(",") + ")" : ""));
      return;
    }
    if (error.message && error.message.includes("does not exist")) {
      console.warn("[upsert][" + table + "] Table missing — run 010_billing_sync.sql in Supabase");
      return;
    }
    const m = error.message && error.message.match(/Could not find the '([^']+)' column/);
    if (m && ESSENTIAL.indexOf(m[1]) === -1 && Object.prototype.hasOwnProperty.call(row, m[1])) {
      delete row[m[1]];
      dropped.push(m[1]);
      continue;
    }
    console.error("[upsert][" + table + "] ERROR:", error.message);
    return;
  }
}

async function syncFromSubscription(sub) {
  const userId = await resolveUserId(sub);
  if (!userId) return;

  const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  let [tier, cycle] = priceToPlan(priceId);
  if (sub.metadata && sub.metadata.tier)  tier  = sub.metadata.tier;
  if (sub.metadata && sub.metadata.cycle) cycle = sub.metadata.cycle;
  if (!tier) tier = "starter";

  const status = mapStatus(sub.status);
  console.log("[sync] user=" + userId + " tier=" + tier + " status=" + status + " sub=" + sub.id);

  const base = {
    user_id: userId, tier, status,
    billing_cycle: cycle || "monthly",
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
  const subRow = base;
  const memRow = Object.assign({}, base, { plan: tier, billing: cycle || "monthly" });

  await Promise.all([
    upsert("subscriptions", subRow),
    upsert("memberships",   memRow),
  ]);
}

exports.handler = async (event) => {
  const sig = event.headers["stripe-signature"];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("[webhook] OK type=" + evt.type + " id=" + evt.id);
  } catch (err) {
    console.error("[webhook] SIG FAIL:", err.message, "— check STRIPE_WEBHOOK_SECRET in Netlify");
    return { statusCode: 400, body: "Webhook signature error: " + err.message };
  }

  try {
    switch (evt.type) {

      case "checkout.session.completed": {
        const s = evt.data.object;
        console.log("[webhook] checkout.session.completed session=" + s.id + " sub=" + s.subscription);
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          sub.metadata = Object.assign({}, sub.metadata, s.metadata); // merge checkout metadata
          await syncFromSubscription(sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
        console.log("[webhook]", evt.type, "sub=" + evt.data.object.id);
        await syncFromSubscription(evt.data.object);
        break;

      case "customer.subscription.deleted": {
        const sub = evt.data.object;
        const userId = await resolveUserId(sub);
        if (userId) {
          const cancelBase = { user_id: userId, tier: "starter", status: "canceled",
            billing_cycle: "monthly", stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, cancel_at_period_end: false };
          await Promise.all([upsert("subscriptions", cancelBase), upsert("memberships", Object.assign({}, cancelBase, { plan: "starter", billing: "monthly" }))]);
        }
        break;
      }

      case "invoice.paid": {
        const inv = evt.data.object;
        console.log("[webhook] invoice.paid inv=" + inv.id + " sub=" + inv.subscription);
        if (inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription);
          await syncFromSubscription(sub);
        }
        break;
      }

      case "invoice.payment_failed": {
        const inv = evt.data.object;
        console.log("[webhook] invoice.payment_failed inv=" + inv.id);
        if (inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription);
          await syncFromSubscription(sub);
        }
        break;
      }

      default:
        console.log("[webhook] ignored:", evt.type);
    }
  } catch (e) {
    console.error("[webhook] HANDLER ERROR:", e.message);
    return { statusCode: 500, body: "Handler error: " + e.message };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true, type: evt.type }) };
};
