# Pegasus — Stripe Billing Setup (do this in Netlify, NOT in code)

Your products already exist in Stripe (test mode). The checkout/portal code is
done. The ONLY remaining step is setting environment variables in Netlify so the
server knows which Stripe Price each plan maps to.

NEVER put keys in the repo. They live only in Netlify env vars.

---

## STEP 1 — Get your 3 monthly Price IDs from Stripe

In the Stripe Dashboard (test mode):
1. Product catalog → click "Professional Access Layer"
2. Under "Pricing", find the $50/mo price and copy its ID — it looks like
   `price_1ABC...`  (NOT the product id `prod_...`)
3. Repeat for "Institutional Access Layer" ($100/mo) and
   "Network Access Layer" ($20/mo).

(Optional) If you want Annual billing to work too, add an annual price to each
product first, then copy those Price IDs as well.

---

## STEP 2 — Get your secret key

Stripe Dashboard → Developers → API keys → "Secret key" (test mode) → `sk_test_...`
Copy it. Do NOT paste it anywhere except the Netlify env var box.

---

## STEP 3 — Get your Supabase service role key (for the billing portal)

Supabase Dashboard → Project Settings → API → "service_role" secret → copy it.

---

## STEP 4 — Set these in Netlify

Netlify → Site settings → Environment variables → add each:

| Variable                      | Value                                              |
|-------------------------------|----------------------------------------------------|
| STRIPE_SECRET_KEY             | sk_test_...  (your secret key from Step 2)         |
| STRIPE_PRICE_PRO_MONTHLY      | price_...    (Professional Access Layer $50/mo)    |
| STRIPE_PRICE_GOLD_MONTHLY     | price_...    (Institutional Access Layer $100/mo)  |
| STRIPE_PRICE_STARTER_MONTHLY  | price_...    (Network Access Layer $20/mo)         |
| SITE_URL                      | https://pegasuslendersgroup.com                    |
| SUPABASE_URL                  | https://trdwsssouhpawhfdkfqf.supabase.co           |
| SUPABASE_SERVICE_ROLE_KEY     | (service_role key from Step 3)                     |

Optional (only if you created annual prices):
| STRIPE_PRICE_PRO_ANNUAL  | price_... |
| STRIPE_PRICE_GOLD_ANNUAL | price_... |
| STRIPE_PRICE_STARTER_ANNUAL | price_... |

After saving, trigger a redeploy (Netlify → Deploys → Trigger deploy →
"Deploy site") so the functions pick up the new variables.

---

## STEP 5 — Turn on the Billing Portal (for "Manage Billing" / "Update")

Stripe Dashboard → Settings → Billing → Customer portal:
- Turn ON "Customers can switch plans" and add your 3 products
- Turn ON "Customers can update payment methods"
- Save

This makes "Manage Billing", "Update" (payment method), and "View all" (invoices)
all work through Stripe's hosted portal.

---

## STEP 6 — Test

1. Sign in on the live site as a member.
2. Membership → "Upgrade to Pro" → you should be redirected to Stripe Checkout.
3. Use test card 4242 4242 4242 4242, any future date, any CVC.
4. After paying, the Stripe webhook updates the subscription in Supabase and your
   tier upgrades automatically.

If a button shows "Checkout unavailable (HTTP 400) — Verify Stripe price IDs":
that means the Price ID env var for that plan isn't set or is misspelled.

---

## IMPORTANT: test mode vs live mode

Everything above uses TEST keys (`sk_test_`, `price_` from sandbox). Real cards
will NOT be charged. When you're ready to go live:
- Recreate the 3 products in Stripe LIVE mode
- Swap the Netlify vars to the LIVE `sk_live_` key and LIVE `price_` IDs
- Test once with a real card

Until then, keep using test mode — it's the correct way to verify the flow.
