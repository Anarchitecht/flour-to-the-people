// GET /api/config
//
// Returns frontend-safe configuration values. The Stripe publishable key is
// designed to be public — it's safe to expose. The secret key NEVER appears
// in this response (or anywhere in the repo).

export function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
      taxEnabled: env.STRIPE_TAX_ENABLED === 'true',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
