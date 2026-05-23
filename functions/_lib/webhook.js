// Stripe webhook signature verification using Web Crypto API
// (Workers don't have Node's crypto module).
//
// Stripe signs each webhook with the schema:
//   stripe-signature: t=TIMESTAMP,v1=SIGNATURE,v1=SIGNATURE,...
// where SIGNATURE = HMAC_SHA256(secret, `${TIMESTAMP}.${rawBody}`)
//
// Returns: the parsed JSON event on success. Throws on signature mismatch
// or timestamp drift > 5 minutes (replay protection).

const TOLERANCE_SECONDS = 300;

export async function verifyAndParseStripeEvent(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader) throw new Error('Missing stripe-signature header');
  if (!webhookSecret) throw new Error('Missing webhook secret');

  // Parse header: t=12345,v1=abc...,v1=def...
  const parts = Object.create(null);
  for (const seg of signatureHeader.split(',')) {
    const [k, v] = seg.split('=');
    if (!k || v === undefined) continue;
    if (!parts[k]) parts[k] = [];
    parts[k].push(v);
  }

  const timestamp = parts.t?.[0];
  const v1Signatures = parts.v1 || [];
  if (!timestamp || v1Signatures.length === 0) {
    throw new Error('Malformed stripe-signature header');
  }

  // Replay protection
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parseInt(timestamp, 10)) > TOLERANCE_SECONDS) {
    throw new Error('Webhook timestamp outside tolerance window');
  }

  // Compute expected HMAC
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(webhookSecret, signedPayload);

  // Constant-time compare against ANY of the v1 signatures Stripe sent
  // (Stripe rotates signatures during secret rolls; multiple may be valid)
  const match = v1Signatures.some((sig) => timingSafeEqual(sig, expected));
  if (!match) throw new Error('Signature mismatch');

  return JSON.parse(rawBody);
}

async function hmacSha256Hex(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
