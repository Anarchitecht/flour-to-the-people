// POST /api/stripe-webhook
//
// Stripe posts events here. We verify the signature, then process the event.
// The only event we care about today is payment_intent.succeeded — that's
// the signal that money was captured and we should fulfill the order.
//
// Idempotency: every event has a unique event.id. We record processed event
// IDs in D1 so retries from Stripe don't double-fulfill.

import { verifyAndParseStripeEvent } from '../_lib/webhook.js';

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return new Response('Server misconfigured', { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = await verifyAndParseStripeEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return new Response(`Webhook Error: ${e.message}`, { status: 400 });
  }

  // Idempotency: if we've already processed this event, return 200 to make Stripe stop retrying
  if (env.DB) {
    try {
      const existing = await env.DB.prepare(
        'SELECT id FROM processed_events WHERE id = ? LIMIT 1'
      ).bind(event.id).first();
      if (existing) {
        return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
      }
    } catch (e) {
      // D1 not bound or schema missing — log and continue (don't lose the event)
      console.error('Idempotency check failed:', e.message);
    }
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event, env);
        break;

      case 'payment_intent.payment_failed':
        // Customer's payment was declined. Stripe shows them the error in the
        // Payment Element directly; nothing for us to do server-side beyond
        // logging.
        console.log('Payment failed:', event.data.object.id, event.data.object.last_payment_error?.message);
        break;

      case 'charge.refunded':
        await handleRefund(event, env);
        break;

      default:
        // Stripe sends ~100 event types; we only care about a few.
        // Returning 200 tells Stripe we accept (don't retry).
        break;
    }
  } catch (e) {
    console.error(`Handler for ${event.type} failed:`, e.message);
    // Return 500 so Stripe retries.
    return new Response(`Handler error: ${e.message}`, { status: 500 });
  }

  // Mark processed
  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO processed_events (id, type, created_at) VALUES (?, ?, ?)'
      ).bind(event.id, event.type, Math.floor(Date.now() / 1000)).run();
    } catch (e) {
      console.error('Failed to record processed event:', e.message);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

async function handlePaymentSucceeded(event, env) {
  const pi = event.data.object;

  // Pull the shipping address from the PaymentIntent itself
  const shipping = pi.shipping || {};
  const customer = {
    email: pi.receipt_email,
    name: shipping.name,
    address: shipping.address,
  };

  let items = [];
  try {
    items = JSON.parse(pi.metadata?.cart_items || '[]');
  } catch {}

  const orderRow = {
    id: pi.id,
    created_at: Math.floor(Date.now() / 1000),
    email: customer.email,
    name: customer.name,
    address_line1: customer.address?.line1,
    address_line2: customer.address?.line2 || '',
    city: customer.address?.city,
    state: customer.address?.state,
    postal_code: customer.address?.postal_code,
    country: customer.address?.country || 'US',
    subtotal_cents: parseInt(pi.metadata?.subtotal_cents || '0', 10),
    shipping_cents: parseInt(pi.metadata?.shipping_cents || '0', 10),
    tax_cents: pi.amount - parseInt(pi.metadata?.subtotal_cents || '0', 10) - parseInt(pi.metadata?.shipping_cents || '0', 10),
    total_cents: pi.amount,
    currency: pi.currency,
    items_json: JSON.stringify(items),
    fulfillment_status: 'pending',
  };

  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO orders (
        id, created_at, email, name,
        address_line1, address_line2, city, state, postal_code, country,
        subtotal_cents, shipping_cents, tax_cents, total_cents, currency,
        items_json, fulfillment_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      orderRow.id, orderRow.created_at, orderRow.email, orderRow.name,
      orderRow.address_line1, orderRow.address_line2, orderRow.city, orderRow.state, orderRow.postal_code, orderRow.country,
      orderRow.subtotal_cents, orderRow.shipping_cents, orderRow.tax_cents, orderRow.total_cents, orderRow.currency,
      orderRow.items_json, orderRow.fulfillment_status
    ).run();
  }

  // Phase 2 extension points (deliberately stubbed):
  //   - sendCustomConfirmationEmail(customer, items, totals) via Resend
  //   - generateShippingLabel(customer.address, totalWeight) via Shippo
  //   - decrementInventory(items) — if/when stock tracking is added
}

async function handleRefund(event, env) {
  const charge = event.data.object;
  const pi = charge.payment_intent;
  if (!pi || !env.DB) return;

  await env.DB.prepare(
    'UPDATE orders SET fulfillment_status = ?, refunded_at = ? WHERE id = ?'
  ).bind(
    charge.amount_refunded === charge.amount ? 'refunded' : 'partial_refund',
    Math.floor(Date.now() / 1000),
    pi
  ).run();
}
