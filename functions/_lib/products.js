// Server-side product catalog. This is the price source of truth.
// The Worker validates every incoming cart against this map. A client editing
// HTML or DevTools to pay $0.01 will fail validation here.
//
// To change prices: edit this file AND the corresponding price in /index.html
// (the HTML is what customers see; this is what they actually pay).

export const PRODUCTS = {
  ap: { name: 'All-Purpose Flour',     price_cents:  800, size: '2 lb', weight_oz: 32 },
  ry: { name: 'Rye Flour',             price_cents:  900, size: '2 lb', weight_oz: 32 },
  pz: { name: 'Pizza Dough Flour',     price_cents:  900, size: '2 lb', weight_oz: 32 },
  pa: { name: 'Pastry Flour',          price_cents:  800, size: '2 lb', weight_oz: 32 },
  pp: { name: 'Pumpernickel',          price_cents:  900, size: '2 lb', weight_oz: 32 },
  km: { name: 'Kamut Flour',           price_cents: 1100, size: '2 lb', weight_oz: 32 },
  sp: { name: 'Spelt Flour',           price_cents:  900, size: '2 lb', weight_oz: 32 },
  ek: { name: 'Einkorn Flour',         price_cents: 1100, size: '2 lb', weight_oz: 32 },
  tf: { name: 'Teff Flour',            price_cents: 1100, size: '2 lb', weight_oz: 32 },
  qn: { name: 'Quinoa Flour',          price_cents: 1100, size: '2 lb', weight_oz: 32 },
  gf: { name: 'GF Flour',              price_cents: 1000, size: '2 lb', weight_oz: 32 },
  ot: { name: 'Oat Flour',             price_cents:  800, size: '2 lb', weight_oz: 32 },
  ml: { name: 'Millet Flour',          price_cents:  900, size: '2 lb', weight_oz: 32 },
  bw: { name: 'Buckwheat Pancake Mix', price_cents: 1000, size: '2 lb', weight_oz: 32 },
  cm: { name: 'Corn Meal',             price_cents:  700, size: '2 lb', weight_oz: 32 },
  cg: { name: 'Corn Grits',            price_cents:  700, size: '2 lb', weight_oz: 32 },
  so: { name: 'Scottish Oatmeal',      price_cents:  900, size: '2 lb', weight_oz: 32 },
};

// Validates a cart from the client. Returns normalized line items + totals.
// Throws Error with a user-safe message on any validation failure.
export function validateCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('Cart is empty');
  }
  if (cart.length > 100) {
    throw new Error('Too many distinct items in cart');
  }

  const lineItems = [];
  let subtotal_cents = 0;
  let total_weight_oz = 0;

  for (const item of cart) {
    if (!item || typeof item.id !== 'string' || !Number.isInteger(item.qty)) {
      throw new Error('Invalid cart item structure');
    }
    if (item.qty < 1 || item.qty > 50) {
      throw new Error(`Quantity out of range for ${item.id} (1–50 allowed)`);
    }

    const product = PRODUCTS[item.id];
    if (!product) {
      throw new Error(`Unknown product: ${item.id}`);
    }

    const line_subtotal = product.price_cents * item.qty;
    lineItems.push({
      id: item.id,
      name: product.name,
      size: product.size,
      qty: item.qty,
      unit_price_cents: product.price_cents,
      line_subtotal_cents: line_subtotal,
    });
    subtotal_cents += line_subtotal;
    total_weight_oz += product.weight_oz * item.qty;
  }

  return { lineItems, subtotal_cents, total_weight_oz };
}

// Flat $8 nationwide, free over $50 subtotal.
// Returns shipping cost in cents.
export function calculateShippingCents(subtotal_cents) {
  return subtotal_cents > 5000 ? 0 : 800;
}

// Sanity bounds — reject orders outside these for fraud/abuse protection.
export const ORDER_MIN_CENTS = 50;     // Stripe minimum
export const ORDER_MAX_CENTS = 100000; // $1000 cap; raise if you start selling bulk
