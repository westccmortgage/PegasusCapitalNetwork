# K West Mortgage — KWestMortgage.com

A premium coastal mortgage lead-generation and education site for **Key West / Monroe County, Florida**, powered by **Sun Coast Capital Mortgage / West Coast Capital Mortgage Inc.**

> Marketing angle: **“Buying in Key West? Don’t assume it has to be jumbo.”**
> Core message: in a high-cost market, check **high-balance conforming** options before assuming a jumbo loan.

This is a **standalone static site** kept in its own folder so it does not overwrite or interfere with CaliforniaMTG.com or the surrounding repository.

## Structure

```
kwestmortgage/
├── index.html               # Homepage — animated coastal hero, scenario builder, all sections
├── concierge.html           # Concierge intro + full scenario builder
├── jumbo-vs-conforming.html # Jumbo vs high-balance conforming (accordion + comparison table)
├── loan-options.html        # All loan programs (high-balance conforming featured)
├── rates.html               # Rates & payments education (no rate quotes)
├── education.html           # Education hub
├── about.html               # About / who we are
├── contact.html             # Contact + scenario form
├── privacy.html             # Privacy policy (cookies, visitor ID, no-sale)
├── terms.html               # Terms of use
├── disclosures.html         # Licensing & compliance disclosures
├── css/kwest.css            # Design system (coastal palette, components, responsive)
├── js/kwest.js              # Nav, scenario rotation, reveal, accordion, forms, cookie consent, visitor ID
├── assets/                  # favicon.svg, og-image.svg (social placeholder)
├── robots.txt
├── sitemap.xml
└── netlify.toml             # Standalone deploy config (base dir = kwestmortgage)
```

## Lead forms — Netlify Forms

The scenario forms (homepage `#builder`, `concierge.html`, and `contact.html`) are native
**Netlify Forms** — no JavaScript, no external endpoint. Each form has:

- `name="key-west-scenario-review"`, `method="POST"`, `action="/thank-you.html"`
- `data-netlify="true"` + hidden `<input name="form-name" value="key-west-scenario-review">`
- `netlify-honeypot="bot-field"` honeypot (a hidden `bot-field`) for spam protection
- Field names: `purchase_price`, `estimated_down_payment`, `property_location`, `occupancy`,
  `property_type`, `income_type`, `avoid_jumbo`, `working_with_realtor`, `timeline_to_purchase`,
  `preferred_contact_method`, `name`, `phone`, `email` (contact form also has `message`)

On submit, Netlify records the submission and redirects to **`/thank-you.html`**.

### Required after first deploy
Netlify only registers forms once a deploy contains them. After deploying:
**Netlify Dashboard → your site → Forms** — confirm `key-west-scenario-review` is listed,
then **Forms → Form notifications → Add notification → Email notification** to
**info@kwestmortgages.com**.

## Privacy / consent

- First-visit cookie consent banner. Analytics + first-party visitor ID activate **only after consent**.
- Consent stored in `localStorage` (`kw_consent`); visitor ID in `kw_visitor_id`.

## Deploy

Static — no build step. On Netlify, set **base directory** to `kwestmortgage`. Point **KWestMortgage.com** at the deploy and set the primary domain. Locally, serve the folder with any static server (e.g. `npx serve kwestmortgage`).

## Before launch (placeholders to replace)

- **Phone** — currently `(888) 656-1256` (shared CaliforniaMTG business line); replace if K West gets its own number.
- **Email** — `info@kwestmortgages.com` placeholder.
- **Sun Coast Capital Mortgage / Florida licensing** details (footer + `disclosures.html`).
- **Hero videos** — drop two files into `assets/`:
  - `assets/hero-desktop.mp4` — horizontal ocean/sunset clip (desktop background)
  - `assets/hero-mobile.mp4` — vertical moon/ocean clip (mobile background)
  Both autoplay/loop/muted/playsInline with `object-fit: cover` and a navy overlay. Until they're added, the animated coastal gradient shows as a graceful fallback.
- **OG image** — `assets/og-image.svg` is a placeholder; swap for a 1200×630 photo/render.
- **Form notifications** — after deploy, add the email notification to `info@kwestmortgages.com` (see "Lead forms" above).

## Compliance notes (built in)

No promises of approval, no rate quotes, no “all buyers qualify,” no “no documents required,” no “guaranteed lowest payment.” Copy uses *may qualify*, *can review*, *subject to guidelines*, *not a commitment to lend*, and *licensed mortgage professional review* throughout.
