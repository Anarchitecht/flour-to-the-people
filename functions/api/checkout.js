// POST /api/checkout
//
// Body (JSON):
//   {
//     cart: [{ id: 'ap', qty: 2 }, ...],
//     email: 'customer@example.com',
//     name: 'Jane Smith',
//     address: { line1, line2?, city, state, postal_code, country? }
//   }
//
// Response:
//   {
//     clientSecret: 'pi_..._secret_...',
//     orderId: 'pi_...',
//     amount: {
//       subtotal_cents: 2400,
//       shipping_cents: 800,
//       tax_cents: 224,    // computed by Stripe Tax
//       total_cents: 3424,
//     }
//   }
//
// Errors return: { error: 'human-readable message' }, HTTP 400 or 500.

import { validateCart, calculateShippingCents, ORDER_MIN_CENTS, ORDER_MAX_CENTS } from '../_lib/products.js';
import { createCustomer, createPaymentIntent, retrievePaymentIntent } from '../_lib/stripe.js';

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: 'Payment system not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // --- Validate inputs ---
  const { cart, email, name, address } = body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Valid email required' }, 400);
  }
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return jsonResponse({ error: 'Name required' }, 400);
  }
  if (!address || typeof address !== 'object') {
    return jsonResponse({ error: 'Shipping address required' }, 400);
  }
  for (const field of ['line1', 'city', 'state', 'postal_code']) {
    if (!address[field] || typeof address[field] !== 'string' || !address[field].trim()) {
      return jsonResponse({ error: `Shipping address missing: ${field}` }, 400);
    }
  }

  // --- Validate cart against server catalog ---
  let cartValidation;
  try {
    cartValidation = validateCart(cart);
  } catch (e) {
    return jsonResponse({ error: e.message }, 400);
  }

  const { lineItems, subtotal_cents } = cartValidation;
  const shipping_cents = calculateShippingCents(subtotal_cents);
  const pre_tax_cents = subtotal_cents + shipping_cents;

  if (pre_tax_cents < ORDER_MIN_CENTS) {
    return jsonResponse({ error: 'Order total below minimum' }, 400);
  }
  if (pre_tax_cents > ORDER_MAX_CENTS) {
    return jsonResponse({ error: 'Order total exceeds maximum' }, 400);
  }

  // --- Create Stripe Customer with shipping address ---
  // Stripe Tax needs a Customer with an address to compute tax.
  let customer;
  try {
    customer = await createCustomer(env.STRIPE_SECRET_KEY, {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      address: {
        line1: address.line1.trim(),
        line2: (address.line2 || '').trim(),
        city: address.city.trim(),
        state: address.state.trim(),
        postal_code: address.postal_code.trim(),
        country: address.country || 'US',
      },
    });
  } catch (e) {
    return jsonResponse({ error: 'Failed to create customer record' }, 500);
  }

  // --- Create PaymentIntent ---
  // Note: Stripe Tax with Payment Element requires the Tax Calculation API
  // (/v1/tax/calculations -> /v1/payment_intents -> /v1/tax/transactions),
  // NOT the automatic_tax param (that's Checkout Sessions only). For now we
  // ship without tax; Phase 2 will implement the Tax Calculation flow when
  // Stripe Tax is activated in the Dashboard.
  let intent;
  try {
    intent = await createPaymentIntent(env.STRIPE_SECRET_KEY, {
      amount: pre_tax_cents,
      currency: 'usd',
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      shipping: {
        name: name.trim(),
        address: {
          line1: address.line1.trim(),
          line2: (address.line2 || '').trim(),
          city: address.city.trim(),
          state: address.state.trim(),
          postal_code: address.postal_code.trim(),
          country: address.country || 'US',
        },
      },
      receipt_email: email.trim().toLowerCase(),
      metadata: {
        cart_items: JSON.stringify(lineItems),
        subtotal_cents: String(subtotal_cents),
        shipping_cents: String(shipping_cents),
      },
    });
  } catch (e) {
    console.error('PaymentIntent create failed:', e.message);
    return jsonResponse({ error: 'Failed to initialize payment' }, 500);
  }

  // Tax is $0 until Stripe Tax is activated and the Tax Calculation flow is wired.
  const total_cents = intent.amount;
  const tax_cents = 0;

  return jsonResponse({
    clientSecret: intent.client_secret,
    orderId: intent.id,
    amount: {
      subtotal_cents,
      shipping_cents,
      tax_cents: Math.max(0, tax_cents),
      total_cents,
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
