-- D1 schema for Flour to the People
-- Apply with: wrangler d1 execute flour-to-the-people --file=schema.sql --remote
--
-- Two tables:
--   orders          — one row per successful payment
--   processed_events — webhook idempotency log (prevents double-fulfillment on Stripe retries)

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,         -- Stripe PaymentIntent ID (pi_...)
  created_at      INTEGER NOT NULL,         -- unix seconds
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  address_line1   TEXT NOT NULL,
  address_line2   TEXT,
  city            TEXT NOT NULL,
  state           TEXT NOT NULL,
  postal_code     TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT 'US',
  subtotal_cents  INTEGER NOT NULL,
  shipping_cents  INTEGER NOT NULL,
  tax_cents       INTEGER NOT NULL,
  total_cents     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'usd',
  items_json      TEXT NOT NULL,            -- serialized line items array
  fulfillment_status TEXT NOT NULL DEFAULT 'pending',  -- pending | shipped | refunded | partial_refund
  shipped_at      INTEGER,
  refunded_at     INTEGER,
  tracking_number TEXT
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_email_idx ON orders(email);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(fulfillment_status);

CREATE TABLE IF NOT EXISTS processed_events (
  id          TEXT PRIMARY KEY,             -- Stripe event ID (evt_...)
  type        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS processed_events_created_at_idx ON processed_events(created_at);
