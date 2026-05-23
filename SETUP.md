# Payment System Setup

Once committed, the code in this repo is structurally complete but inert until you connect a Stripe account and configure environment variables. Walk through these steps in order — each one is gated on the previous.

## 1. Create the Stripe account

1. Sign up at https://dashboard.stripe.com/register
2. Activate the account: legal entity name, EIN or SSN (for sole proprietor), bank account for payouts
3. Stripe's identity verification can take a few hours to a day; you can do steps 2–4 below in parallel using **test mode**

## 2. Get your API keys

Stripe Dashboard → Developers → API keys. Two keys matter:

| Key | Format | Sensitivity |
|---|---|---|
| Publishable key | `pk_test_...` (test) / `pk_live_...` (live) | Safe to expose — designed for client-side use |
| Secret key | `sk_test_...` / `sk_live_...` | NEVER commit. Never share. Cloudflare env var only. |

Start with the test keys. You'll swap to live keys once test mode works end-to-end.

## 3. Create the D1 database

From your machine, with `wrangler` authenticated to Cloudflare:

```bash
# Create the database
wrangler d1 create flour-to-the-people-orders

# wrangler will print a database_id — copy it.
# Apply the schema:
wrangler d1 execute flour-to-the-people-orders --file=schema.sql --remote
```

Then bind the database to your Pages project:

1. Cloudflare Dashboard → Pages → `flour-to-the-people` → Settings → Functions → D1 database bindings
2. Click "Add binding"
3. Variable name: `DB`
4. D1 database: select the one you just created
5. Save and redeploy (or it'll bind on the next push)

## 4. Configure Pages environment variables

Cloudflare Dashboard → Pages → `flour-to-the-people` → Settings → Environment variables → Production:

| Variable | Value | Where it comes from |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (then `sk_live_...`) | Stripe Dashboard → API keys |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (then `pk_live_...`) | Stripe Dashboard → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Step 5 below |
| `STRIPE_TAX_ENABLED` | `true` or `false` | Set `true` after Stripe Tax is configured (step 6) |

Mark `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as **encrypted** (the toggle in the Cloudflare UI). Publishable key can be plain.

## 5. Register the Stripe webhook endpoint

Stripe Dashboard → Developers → Webhooks → "Add endpoint":

- **Endpoint URL:** `https://flour-to-the-people.pages.dev/api/stripe-webhook`
- **Events to send:** select these three:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
- **API version:** latest
- After creating, click the endpoint and reveal the **signing secret** (`whsec_...`)
- Paste into `STRIPE_WEBHOOK_SECRET` in Cloudflare env vars

## 6. Enable Stripe Tax

Stripe Dashboard → Tax → "Get started":

1. Add your business address (Floyd, VA)
2. Set product tax category: most flour products fall under **"Food and food ingredients - unprepared"** (often zero-rated; varies by state — Stripe handles this)
3. Activate Stripe Tax (toggles on)
4. In your Cloudflare env vars, set `STRIPE_TAX_ENABLED=true`

Stripe will now tell you which states you've crossed nexus in. Register with each state's DOR as Stripe instructs (most states have online registration; many small sellers stay under thresholds in most states for the first year).

## 7. Test end-to-end (test mode)

After deploying:

1. Visit https://flour-to-the-people.pages.dev
2. Add items to cart, click checkout
3. Fill in any address; pay with test card `4242 4242 4242 4242`, any future expiry, any 3-digit CVC
4. Order should complete; success modal shows
5. Stripe Dashboard → Payments: confirm the payment is listed
6. Cloudflare Pages → Functions logs: confirm the webhook fired and the order was written to D1
7. Query D1 to confirm: `wrangler d1 execute flour-to-the-people-orders --command="SELECT * FROM orders" --remote`

Test cards for failure paths:
- `4000 0000 0000 9995` — declined (insufficient funds)
- `4000 0027 6000 3184` — 3D Secure required (tests the redirect path)

## 8. Switch to live mode

After test mode works perfectly:

1. Stripe Dashboard → toggle to **Live mode** in the sidebar
2. Activate account if you haven't (real bank info, real entity)
3. Get the **live** API keys (`pk_live_...`, `sk_live_...`)
4. Create a **new webhook endpoint** in live mode (same URL, same events; new signing secret)
5. Update Cloudflare env vars with live keys + new webhook secret
6. Redeploy Pages
7. Make a real $0.50 test purchase with your own card to confirm

## How the mill receives orders

Three notification paths today, no extra accounts needed:

1. **Stripe Dashboard email alerts** — Settings → Team and Security → Notification preferences → enable "Successful payment" emails. Every paid order emails the mill with cart contents and shipping address.
2. **Stripe Dashboard Orders view** — payments tab shows everything, filterable, searchable
3. **D1 orders table** — single source of truth, queryable from wrangler or any tool

When you're ready to upgrade fulfillment:

- **Custom email confirmations** (Phase 2): add Resend, ~30 min of integration
- **Automated shipping labels** (Phase 2): add Shippo, ~1–2 hours of integration
- **Customer "my orders" portal** (Phase 3): Stripe Customer Portal is the lowest-effort path, free to enable

## What's in this code

```
/functions/
  /api/
    /checkout.js         POST: validate cart → create Stripe Customer + PaymentIntent
    /config.js           GET: return publishable key + tax flag for the frontend
    /stripe-webhook.js   POST: verify Stripe signature → save order to D1
  /_lib/
    /products.js         Server-side catalog (price source of truth)
    /stripe.js           Stripe REST helpers (no SDK; Workers don't have Node)
    /webhook.js          HMAC signature verification via Web Crypto
/schema.sql              D1 schema (orders + processed_events)
/index.html              Two-step checkout modal + Payment Element mount + localStorage cart
```

## Common failure modes (and fixes)

- **"Payment system not yet configured"** — `STRIPE_PUBLISHABLE_KEY` env var missing in Cloudflare. Add it, redeploy.
- **Webhook signature mismatch** — `STRIPE_WEBHOOK_SECRET` doesn't match the one in Stripe Dashboard. Either you copied from the wrong webhook endpoint, or you're using test secret on live endpoint (or vice versa).
- **Order paid but no D1 row** — D1 binding name in Cloudflare must be exactly `DB`. Check the binding in Pages settings.
- **Tax shows $0.00 always** — `STRIPE_TAX_ENABLED` not set to `"true"` (string, not boolean), or Stripe Tax not activated in Stripe Dashboard, or shipping address state isn't a state where you've crossed nexus.
- **Customer card declined** — test card or real declined. Stripe sends `payment_intent.payment_failed` webhook. Customer sees the error inline in the Payment Element.
