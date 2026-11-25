import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';
import { hashPassword } from './passwords';

/**
 * AltMall's own database (the merchant's system of record). AltMall has NO access to the ARAF
 * database — everything it knows about financing comes from the public API and signed webhooks.
 */

type G = typeof globalThis & { __altmallPool?: Pool; __altmallSchema?: Promise<void> };
const g = globalThis as G;

function pool(): Pool {
  if (!g.__altmallPool) {
    g.__altmallPool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
    g.__altmallPool.on('error', (err) => console.error('[altmall] pg pool error', err.message));
  }
  return g.__altmallPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vendor_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS order_reference_seq START 101;
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  delivery_name TEXT NOT NULL,
  delivery_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_city TEXT NOT NULL,
  delivery_state TEXT NOT NULL,
  araf_session_id TEXT,
  araf_checkout_url TEXT,
  araf_application_reference TEXT,
  araf_status TEXT,
  araf_release_reference TEXT,
  araf_release_status TEXT,
  release_authorized BOOLEAN NOT NULL DEFAULT false,
  araf_attempts INT NOT NULL DEFAULT 0,
  araf_last_synced_at TIMESTAMPTZ,
  last_event_version INT NOT NULL DEFAULT -1,
  tracking_reference TEXT,
  carrier TEXT,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id, created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INT NOT NULL CHECK (qty > 0),
  unit_kobo BIGINT NOT NULL CHECK (unit_kobo > 0),
  category TEXT NOT NULL,
  vendor_reference TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE TABLE IF NOT EXISTS order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events(order_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT,
  merchant_order_reference TEXT,
  resource_version INT,
  raw JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_receipts (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_id TEXT,
  type TEXT,
  merchant_order_reference TEXT,
  verified BOOLEAN NOT NULL,
  verification_detail TEXT NOT NULL,
  http_status INT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_receipts_time_idx ON webhook_receipts(received_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`;

/** Sandbox demo shopper (displayed on the sign-in page). */
export const DEMO_CUSTOMER = { email: 'demo@altmall.example', password: 'Demo-Shopper-2026!', name: 'Amina Bello', phone: '+2348031234567' };

export async function ensureSchema(): Promise<void> {
  if (!g.__altmallSchema) {
    g.__altmallSchema = (async () => {
      const c = await pool().connect();
      try {
        await c.query('SELECT pg_advisory_lock(hashtext($1))', ['altmall-schema']);
        await c.query(SCHEMA);
        const seeded = await c.query('SELECT 1 FROM customers WHERE email = $1', [DEMO_CUSTOMER.email]);
        if (!seeded.rowCount) {
          await c.query('INSERT INTO customers (email, name, phone, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING', [
            DEMO_CUSTOMER.email,
            DEMO_CUSTOMER.name,
            DEMO_CUSTOMER.phone,
            await hashPassword(DEMO_CUSTOMER.password),
          ]);
        }
        await c.query(`INSERT INTO settings (key, value) VALUES ('webhook_fail_remaining', '0') ON CONFLICT (key) DO NOTHING`);
      } finally {
        await c.query('SELECT pg_advisory_unlock(hashtext($1))', ['altmall-schema']).catch(() => undefined);
        c.release();
      }
    })().catch((err) => {
      g.__altmallSchema = undefined;
      throw err;
    });
  }
  return g.__altmallSchema;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
