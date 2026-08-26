import pool from './pool.js';

/**
 * Runs all SQL migration statements in order.
 * In production you'd use a proper migration tool (node-pg-migrate, Knex, etc.)
 * For the hackathon, we inline the schema DDL.
 */
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Extensions ──
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // ── Tenants ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name          VARCHAR(255) NOT NULL,
        slug          VARCHAR(100) UNIQUE NOT NULL,
        phone         VARCHAR(20),
        address       TEXT,
        currency      VARCHAR(3) DEFAULT 'PKR',
        timezone      VARCHAR(50) DEFAULT 'Asia/Karachi',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Maps each tenant to the Meta WhatsApp phone_number_id that owns their
    // inbound webhook traffic, so incoming messages route to the right tenant
    // instead of a hardcoded "first tenant" fallback.
    await client.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id VARCHAR(50) UNIQUE;
    `);

    // ── Users (multi-tenant via tenant_id) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name          VARCHAR(255) NOT NULL,
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role          VARCHAR(20) DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Branches ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name          VARCHAR(255) NOT NULL,
        address       TEXT,
        phone         VARCHAR(20),
        is_active     BOOLEAN DEFAULT true,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Menu Categories ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_categories (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
        name          VARCHAR(255) NOT NULL,
        sort_order    INTEGER DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Menu Items ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
        category_id   UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
        name          VARCHAR(255) NOT NULL,
        name_urdu     VARCHAR(255),
        description   TEXT,
        price         DECIMAL(10,2) NOT NULL,
        image_url     TEXT,
        is_available  BOOLEAN DEFAULT true,
        tags          TEXT[] DEFAULT '{}',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Customers ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        phone         VARCHAR(20) NOT NULL,
        name          VARCHAR(255),
        address       TEXT,
        notes         TEXT,
        order_count   INTEGER DEFAULT 0,
        total_spent   DECIMAL(12,2) DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, phone)
      );
    `);

    // ── Orders ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
        customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
        order_number  SERIAL,
        channel       VARCHAR(20) DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'in_person', 'phone', 'web')),
        status        VARCHAR(30) DEFAULT 'new' CHECK (status IN ('new','confirmed','preparing','ready','delivered','cancelled')),
        subtotal      DECIMAL(10,2) DEFAULT 0,
        tax           DECIMAL(10,2) DEFAULT 0,
        delivery_fee  DECIMAL(10,2) DEFAULT 0,
        total         DECIMAL(10,2) DEFAULT 0,
        delivery_address TEXT,
        payment_method   VARCHAR(30) DEFAULT 'cash' CHECK (payment_method IN ('cash','jazzcash','easypaisa','card')),
        notes         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Order Items ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id  UUID REFERENCES menu_items(id) ON DELETE SET NULL,
        name          VARCHAR(255) NOT NULL,
        quantity      INTEGER NOT NULL DEFAULT 1,
        unit_price    DECIMAL(10,2) NOT NULL,
        total_price   DECIMAL(10,2) NOT NULL,
        notes         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Restaurant Tables (persistent per-physical-table QR code) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        table_number  VARCHAR(20) NOT NULL,
        qr_code_token VARCHAR(64) UNIQUE NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(branch_id, table_number)
      );
    `);

    // ── Table Sessions (one open dining session per table at a time) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS table_sessions (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        table_id      UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
        status        VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','bill_requested','closed')),
        opened_at     TIMESTAMPTZ DEFAULT NOW(),
        closed_at     TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_table_sessions_one_open ON table_sessions(table_id) WHERE status != 'closed';`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_table_sessions_table ON table_sessions(table_id);`);

    // Link orders back to the dine-in session that placed them (nullable — most orders aren't dine-in)
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_session_id UUID REFERENCES table_sessions(id);`);

    // ── Reservations ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        customer_name     VARCHAR(100) NOT NULL,
        customer_phone    VARCHAR(20) NOT NULL,
        party_size        SMALLINT NOT NULL,
        reserved_for      TIMESTAMPTZ NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','seated','completed','cancelled','no_show')),
        notes             TEXT,
        table_session_id  UUID REFERENCES table_sessions(id),
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reservations_branch_time ON reservations(branch_id, reserved_for);`);

    // ── Loyalty ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_config (
        tenant_id                 UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        points_per_currency_unit  NUMERIC(6,2) NOT NULL DEFAULT 1.0,
        redemption_rate           NUMERIC(6,2) NOT NULL DEFAULT 0.01,
        enabled                   BOOLEAN NOT NULL DEFAULT true
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_points (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        points_change INTEGER NOT NULL,
        reason        VARCHAR(20) NOT NULL CHECK (reason IN ('earned','redeemed','adjusted')),
        order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_points_customer ON loyalty_points(customer_id);`);

    // ── Reviews ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id  UUID REFERENCES menu_items(id) ON DELETE SET NULL,
        customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment       TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_menu_item ON reviews(menu_item_id);`);

    // ── Push Notification Subscriptions ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        endpoint      TEXT NOT NULL,
        keys          JSONB NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(customer_id, endpoint)
      );
    `);

    // Orders need a discount column so loyalty-point redemption can reduce
    // the total without forking a second order-creation path.
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;`);

    // ── Conversations (WhatsApp session state) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
        phone         VARCHAR(20) NOT NULL,
        state         VARCHAR(30) DEFAULT 'idle' CHECK (state IN ('idle','ordering','confirming','completed')),
        context       JSONB DEFAULT '{}',
        order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Inventory (basic tracking for V1) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
        name          VARCHAR(255) NOT NULL,
        unit          VARCHAR(50) DEFAULT 'kg',
        current_qty   DECIMAL(10,2) DEFAULT 0,
        min_qty       DECIMAL(10,2) DEFAULT 0,
        last_restocked TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Payments (impl-01) — tracks every payment regardless of channel/method ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        method            VARCHAR(20) NOT NULL CHECK (method IN ('jazzcash','easypaisa','card','cod')),
        status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
        amount            NUMERIC(10,2) NOT NULL,
        gateway_reference VARCHAR(255),
        gateway_response  JSONB,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);`);

    // ── Broadcast campaigns (impl-07) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcast_campaigns (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name              VARCHAR(150) NOT NULL,
        message_template  TEXT NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','completed','failed')),
        scheduled_for     TIMESTAMPTZ,
        created_by        UUID REFERENCES users(id),
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id       UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
        customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped_no_window')),
        sent_at           TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign ON broadcast_recipients(campaign_id);`);

    // ── Indexes for performance ──
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_menu_items_tenant ON menu_items(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_menu_items_branch ON menu_items(branch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON customers(tenant_id, phone);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(tenant_id, phone);`);

    await client.query('COMMIT');
    console.log('[migrate] all migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
