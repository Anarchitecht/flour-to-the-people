// Stripe REST API helpers. Workers don't have Node, so we can't use the
// official stripe-node SDK. We talk to api.stripe.com directly with fetch.
// Form-encoded bodies; URLSearchParams handles the encoding for us.

const STRIPE_API = 'https://api.stripe.com/v1';

// Flatten nested objects to Stripe's bracket notation:
//   { metadata: { items: '[...]' } } -> 'metadata[items]=...'
function flattenForm(obj, prefix = '') {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const sub = flattenForm(value, k);
      sub.forEach((v, sk) => params.append(sk, v));
    } else {
      params.append(k, String(value));
    }
  }
  return params;
}

async function stripeRequest(secretKey, path, method, body) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };
  let init = { method, headers };

  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = flattenForm(body).toString();
  }

  const res = await fetch(`${STRIPE_API}${path}`, init);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe ${method} ${path} failed`);
    err.status = res.status;
    err.stripeCode = data.error?.code;
    throw err;
  }
  return data;
}

export function createCustomer(secretKey, { email, name, address }) {
  return stripeRequest(secretKey, '/customers', 'POST', {
    email,
    name,
    address: {
      line1: address.line1,
      line2: address.line2 || '',
      city: address.city,
      state: address.state,
      postal_code: address.postal_code,
      country: address.country || 'US',
    },
    shipping: {
      name,
      address: {
        line1: address.line1,
        line2: address.line2 || '',
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        country: address.country || 'US',
      },
    },
  });
}

export function createPaymentIntent(secretKey, params) {
  return stripeRequest(secretKey, '/payment_intents', 'POST', params);
}

export function retrievePaymentIntent(secretKey, id) {
  return stripeRequest(secretKey, `/payment_intents/${id}`, 'GET');
}
