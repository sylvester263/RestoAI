import pool from './pool.js';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../services/permissions.js';

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

    // ── Landing page builder (impl-11) — one branded marketing site per tenant ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS landing_pages (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id               UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
        template_id             VARCHAR(50) NOT NULL,
        subdomain               VARCHAR(63) UNIQUE NOT NULL,
        custom_domain           VARCHAR(255) UNIQUE,
        custom_domain_verified  BOOLEAN NOT NULL DEFAULT false,
        published               BOOLEAN NOT NULL DEFAULT false,
        content                 JSONB NOT NULL DEFAULT '{}',
        theme                   JSONB NOT NULL DEFAULT '{}',
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_landing_pages_subdomain ON landing_pages(subdomain);`);

    // ── POS tabs (impl-04) — counter/dine-in/phone orders taken by staff ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_tabs (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        table_session_id  UUID REFERENCES table_sessions(id),
        order_type        VARCHAR(20) NOT NULL CHECK (order_type IN ('counter','dine_in','phone')),
        status            VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','voided')),
        opened_by         UUID REFERENCES users(id),
        customer_name     VARCHAR(255),
        customer_phone    VARCHAR(20),
        discount_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
        discount_reason   TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        settled_at        TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_tabs_branch ON pos_tabs(branch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_tabs_tenant_status ON pos_tabs(tenant_id, status);`);

    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_tab_id UUID REFERENCES pos_tabs(id);`);
    // payment_method has no NOT NULL constraint and its CHECK already passes
    // on NULL (SQL: `NULL IN (...)` is NULL, not FALSE) — so POS rounds can
    // leave it unset until settlement chooses one, no constraint change needed.
    await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check;`);
    await client.query(`ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN ('whatsapp','in_person','phone','web','pos'));`);

    // ── Riders, delivery tracking & cash reconciliation (impl-05) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS riders (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        name          VARCHAR(100) NOT NULL,
        phone         VARCHAR(20) NOT NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_riders_branch ON riders(branch_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rider_assignments (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id          UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        rider_id          UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
        assigned_at       TIMESTAMPTZ DEFAULT NOW(),
        picked_up_at      TIMESTAMPTZ,
        delivered_at      TIMESTAMPTZ,
        cash_collected    NUMERIC(10,2),
        cash_reconciled   BOOLEAN DEFAULT false
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rider_assignments_rider ON rider_assignments(rider_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cash_reconciliations (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rider_id          UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
        period_start      TIMESTAMPTZ NOT NULL,
        period_end        TIMESTAMPTZ NOT NULL,
        total_expected    NUMERIC(10,2) NOT NULL,
        total_collected   NUMERIC(10,2) NOT NULL,
        variance          NUMERIC(10,2) NOT NULL,
        reconciled_by     UUID REFERENCES users(id),
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Customer CRM: tags & segments (impl-10 part A) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_tags (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        tag           VARCHAR(50) NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(customer_id, tag)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_segments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name          VARCHAR(100) NOT NULL,
        filter_rules  JSONB NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_segments_tenant ON customer_segments(tenant_id);`);

    // ── Granular RBAC (impl-10 part B) ──
    // `permissions` is a global, non-tenant-scoped catalog of what keys exist
    // (a permission key means the same thing for every restaurant).
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key           VARCHAR(50) UNIQUE NOT NULL,
        description   TEXT NOT NULL
      );
    `);
    for (const p of PERMISSIONS) {
      await client.query(
        `INSERT INTO permissions (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [p.key, p.description],
      );
    }

    // Deviation from the spec's literal schema: role_permissions here is
    // tenant-scoped (tenant_id added to the PK). The spec's own prose calls
    // for permissions "configurable per-tenant" but the SQL it gave omitted
    // tenant_id — without it, one restaurant's owner editing what "manager"
    // can do would change that role for every tenant on the platform, which
    // is exactly the cross-tenant leakage class of bug this codebase's
    // earlier security audit was about eliminating.
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        role            VARCHAR(20) NOT NULL,
        permission_key  VARCHAR(50) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
        PRIMARY KEY (tenant_id, role, permission_key)
      );
    `);

    // Seed every existing tenant with the defaults that reproduce today's
    // actual behavior (see services/permissions.js for why each default is
    // what it is) — so migrating never revokes access anyone already has.
    const tenantsRes = await client.query('SELECT id FROM tenants');
    for (const tenant of tenantsRes.rows) {
      for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        for (const key of keys) {
          await client.query(
            `INSERT INTO role_permissions (tenant_id, role, permission_key) VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, role, permission_key) DO NOTHING`,
            [tenant.id, role, key],
          );
        }
      }
    }

    // ── Full inventory: recipes, suppliers, purchase orders (impl-08) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name            VARCHAR(150) NOT NULL,
        contact_phone   VARCHAR(20),
        contact_email   VARCHAR(150),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);`);

    // Deviation from the spec's literal DDL: adds preferred_supplier_id.
    // impl-19's replenishment agent needs a default supplier to draft a PO
    // against, and impl-08's own schema had no way to express "who do we
    // usually buy this from" — without it, every approval would need a
    // supplier picked by hand with no sensible default.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id             UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        name                  VARCHAR(150) NOT NULL,
        unit                  VARCHAR(20) NOT NULL,
        current_stock         NUMERIC(12,3) NOT NULL DEFAULT 0,
        low_stock_threshold   NUMERIC(12,3) NOT NULL DEFAULT 0,
        cost_per_unit         NUMERIC(10,2) NOT NULL DEFAULT 0,
        preferred_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        created_at            TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ingredients_branch ON ingredients(branch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ingredients_tenant ON ingredients(tenant_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_item_id        UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        ingredient_id       UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        quantity_required   NUMERIC(12,3) NOT NULL,
        UNIQUE(menu_item_id, ingredient_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipes_menu_item ON recipes(menu_item_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipes_ingredient ON recipes(ingredient_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        supplier_id   UUID NOT NULL REFERENCES suppliers(id),
        status        VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
        ordered_at    TIMESTAMPTZ,
        received_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id, status);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        ingredient_id       UUID NOT NULL REFERENCES ingredients(id),
        quantity            NUMERIC(12,3) NOT NULL,
        unit_cost           NUMERIC(10,2) NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);`);

    // Tracks whether an unavailable menu item was auto-86'd by the
    // ingredient-depletion logic (vs. a manual staff decision) — restocking
    // must only ever re-enable the former, never override the latter.
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS auto_unavailable BOOLEAN NOT NULL DEFAULT false;`);

    // ── Coupons & discounts (impl-12) ──
    // No written spec exists for impl-12 anywhere in the repo — it's only
    // referenced by name as a dependency in impl-15 (winback) and impl-21
    // (abuse detection). Schema and scope below are my own design, sized to
    // exactly what those two specs already assume: a customer-targeted
    // single-use code with an expiry (impl-15), and a redemption log to
    // compute abuse velocity from (impl-21) — not a general promotions engine.
    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code                      VARCHAR(30) NOT NULL,
        discount_type             VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent','fixed')),
        discount_value            NUMERIC(10,2) NOT NULL,
        usage_limit_per_customer  INTEGER NOT NULL DEFAULT 1,
        max_redemptions           INTEGER,
        expires_at                TIMESTAMPTZ,
        customer_id               UUID REFERENCES customers(id) ON DELETE CASCADE,
        created_by                UUID REFERENCES users(id),
        active                    BOOLEAN NOT NULL DEFAULT true,
        created_at                TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, code)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        coupon_id         UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
        order_id          UUID REFERENCES orders(id) ON DELETE CASCADE,
        customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
        discount_amount   NUMERIC(10,2) NOT NULL,
        redeemed_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id, redeemed_at);`);

    // ── Agentic AI systems (impl-14..21) ──
    // Owner-facing on/off controls — automation an owner should be able to
    // disable, not something forced on silently.
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_winback_enabled BOOLEAN NOT NULL DEFAULT true;`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_dispatch_mode VARCHAR(20) NOT NULL DEFAULT 'suggest_only' CHECK (agent_dispatch_mode IN ('suggest_only','auto'));`);

    // impl-14 — daily briefing idempotency (one briefing per tenant per day)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_briefing_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        briefing_date DATE NOT NULL,
        sent_at       TIMESTAMPTZ DEFAULT NOW(),
        content       TEXT NOT NULL,
        UNIQUE(tenant_id, briefing_date)
      );
    `);

    // impl-15 — win-back message log (also the re-trigger cooldown source)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_winback_log (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id            UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        triggered_at           TIMESTAMPTZ DEFAULT NOW(),
        days_since_last_order  INTEGER NOT NULL,
        message_sent           TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_winback_log_tenant_customer ON agent_winback_log(tenant_id, customer_id, triggered_at);`);
    // impl-12 now exists — real coupon reference (added after coupons/coupon_redemptions above).
    await client.query(`ALTER TABLE agent_winback_log ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id);`);

    // impl-16 — dispatch reasoning log (both committed auto-assigns and
    // previewed suggestions, distinguished by auto_assigned)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_dispatch_log (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id               UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        rider_id               UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
        reasoning              TEXT NOT NULL,
        candidates_considered  JSONB,
        auto_assigned          BOOLEAN DEFAULT true,
        created_at             TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_log_tenant ON agent_dispatch_log(tenant_id, created_at DESC);`);

    // impl-18 — reconciliation flags
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_reconciliation_flags (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id      UUID REFERENCES orders(id) ON DELETE CASCADE,
        flag_type     VARCHAR(50) NOT NULL,
        description   TEXT NOT NULL,
        severity      VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high')),
        status        VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','dismissed')),
        detected_at   TIMESTAMPTZ DEFAULT NOW(),
        reviewed_by   UUID REFERENCES users(id),
        reviewed_at   TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_tenant ON agent_reconciliation_flags(tenant_id);`);

    // impl-21 — abuse/fraud flags
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_abuse_flags (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        flag_type          VARCHAR(30) NOT NULL,
        customer_id        UUID REFERENCES customers(id) ON DELETE CASCADE,
        related_entity_id  UUID, -- e.g. a coupon id for coupon_abuse — dedup needs a per-entity key too, not just per-customer
        description        TEXT NOT NULL,
        evidence           JSONB NOT NULL,
        severity           VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high')),
        status             VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','confirmed','false_positive')),
        detected_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE agent_abuse_flags ADD COLUMN IF NOT EXISTS related_entity_id UUID;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_abuse_flags_tenant ON agent_abuse_flags(tenant_id);`);

    // impl-19 — replenishment suggestions (never auto-orders; approval creates a real PO)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_replenishment_suggestions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ingredient_id       UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        suggested_quantity  NUMERIC(12,3) NOT NULL,
        reasoning           TEXT NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed','ordered')),
        purchase_order_id   UUID REFERENCES purchase_orders(id),
        created_at          TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_replenishment_tenant ON agent_replenishment_suggestions(tenant_id, status);`);

    // impl-20 — menu/pricing insights (velocity + margin, deterministic classification)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_menu_insights (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        menu_item_id      UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        insight_type      VARCHAR(30) NOT NULL,
        recommendation    TEXT NOT NULL,
        supporting_data   JSONB NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','acted_on','dismissed')),
        generated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_menu_insights_tenant ON agent_menu_insights(tenant_id, status);`);

    // Concurrency hardening: a plain "check existing, then insert" in application
    // code has a race window — two overlapping scan runs (e.g. a manually
    // triggered demo run overlapping a scheduled one) can both pass the SELECT
    // before either INSERTs, producing duplicate open findings. Each agent's
    // own verification steps explicitly require "run twice, no duplicate", so
    // this is enforced at the DB level too, not just in application logic —
    // partial unique indexes scoped to the "still open" status, so a finding
    // can recur later after being resolved/dismissed/acted on.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_insights_dedup
      ON agent_menu_insights(tenant_id, menu_item_id, insight_type) WHERE status = 'new';
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_flags_dedup
      ON agent_reconciliation_flags(tenant_id, order_id, flag_type) WHERE status = 'open';
    `);
    // Dedup key varies by flag_type's actual subject: repeat_cancel/rapid_reorder
    // are per-customer (customer_id set), coupon_abuse is per-coupon
    // (related_entity_id set, customer_id null), review_pattern is tenant-wide
    // (both null). A plain UNIQUE index treats every NULL as distinct, so
    // coalescing down to a single sentinel is what makes each case dedupe
    // correctly instead of either never colliding or colliding across
    // unrelated coupons/customers.
    // DROP + recreate rather than IF NOT EXISTS: an earlier version of this
    // index (before related_entity_id existed) may already be on disk under
    // the same name, and CREATE ... IF NOT EXISTS would silently keep that
    // stale definition instead of picking up the corrected one.
    await client.query(`DROP INDEX IF EXISTS idx_abuse_flags_dedup;`);
    await client.query(`
      CREATE UNIQUE INDEX idx_abuse_flags_dedup
      ON agent_abuse_flags(tenant_id, flag_type, COALESCE(customer_id, related_entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
      WHERE status = 'open';
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_replenishment_dedup
      ON agent_replenishment_suggestions(tenant_id, ingredient_id) WHERE status = 'pending';
    `);

    // ── Staff invites (impl-23) — owner/manager invites a staff member by
    // email; the invitee sets their own password on accept, creating a
    // normal `users` row. Owner/staff share the existing users/JWT system,
    // so this table only exists to bridge "invited" -> "activated". ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_invites (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email         VARCHAR(255) NOT NULL,
        phone         VARCHAR(20),
        role          VARCHAR(20) NOT NULL CHECK (role IN ('manager','staff')),
        branch_id     UUID REFERENCES branches(id),
        invite_token  VARCHAR(64) UNIQUE NOT NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired')),
        expires_at    TIMESTAMPTZ NOT NULL,
        created_by    UUID REFERENCES users(id),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_staff_invites_tenant ON staff_invites(tenant_id, status);`);

    // ── Rider PIN login (impl-23) — riders authenticate with phone + PIN
    // via a separate, lighter-weight auth path than owner/staff. ──
    await client.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS pin_hash TEXT;`);
    await client.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);

    // ── RestoAI's own marketing-site contact form (impl-22) — not
    // tenant-scoped, this is a lead for RestoAI itself, not a restaurant. ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name          VARCHAR(255) NOT NULL,
        email         VARCHAR(255) NOT NULL,
        restaurant    VARCHAR(255),
        phone         VARCHAR(20),
        message       TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Complete POS billing (impl-24, extends impl-04) ──

    // Provincial sales tax — PRA/SRB/KPRA/BRA each set their own rate;
    // unconfigured branches stay at 'NONE'/0% rather than silently assuming one.
    await client.query(`
      CREATE TABLE IF NOT EXISTS tax_config (
        branch_id                UUID PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
        tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tax_authority             VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK (tax_authority IN ('PRA','SRB','KPRA','BRA','NONE')),
        tax_rate                  NUMERIC(5,2) NOT NULL DEFAULT 0,
        tax_registration_number   VARCHAR(50),
        updated_at                TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Split-tender: one tab settled across more than one payment method.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_tab_payments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pos_tab_id    UUID NOT NULL REFERENCES pos_tabs(id) ON DELETE CASCADE,
        method        VARCHAR(20) NOT NULL CHECK (method IN ('cash','card','jazzcash','easypaisa')),
        amount        NUMERIC(10,2) NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_tab_payments_tab ON pos_tab_payments(pos_tab_id);`);

    // Void (pre-settlement) / refund (post-settlement) audit trail. authorized_by
    // is NOT NULL and always the manager/owner who approved it — requested_by is
    // only set when a cashier initiated the request and someone else approved it.
    // `method` is refund-only (which drawer/channel the money actually left
    // from) — deviates from the spec's literal table shape because without it
    // the Z-report can't tell a cash refund from a card refund when computing
    // the cash drawer's expected closing balance.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_voids (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        pos_tab_id      UUID REFERENCES pos_tabs(id),
        order_id        UUID REFERENCES orders(id),
        type            VARCHAR(10) NOT NULL CHECK (type IN ('void','refund')),
        method          VARCHAR(20) CHECK (method IN ('cash','card','jazzcash','easypaisa')),
        amount          NUMERIC(10,2) NOT NULL,
        reason          TEXT NOT NULL,
        authorized_by   UUID NOT NULL REFERENCES users(id),
        requested_by    UUID REFERENCES users(id),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_voids_tenant ON pos_voids(tenant_id);`);

    // Cash drawer / shift tracking — one row per cashier's shift, not one per
    // branch, since several staff can be on the floor with their own drawer.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_shifts (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id                 UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        opened_by                 UUID NOT NULL REFERENCES users(id),
        opening_cash_float        NUMERIC(10,2) NOT NULL,
        closed_by                 UUID REFERENCES users(id),
        closing_cash_counted      NUMERIC(10,2),
        closing_cash_expected     NUMERIC(10,2),
        variance                  NUMERIC(10,2),
        status                    VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        opened_at                 TIMESTAMPTZ DEFAULT NOW(),
        closed_at                 TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_shifts_open ON pos_shifts(tenant_id, branch_id, opened_by, status);`);

    await client.query(`ALTER TABLE pos_tabs ADD COLUMN IF NOT EXISTS pos_shift_id UUID REFERENCES pos_shifts(id);`);
    // Extend the existing status enum with 'held' (parked tabs) without
    // touching the 'open'/'settled'/'voided' values impl-04 already relies on.
    await client.query(`ALTER TABLE pos_tabs DROP CONSTRAINT IF EXISTS pos_tabs_status_check;`);
    await client.query(`ALTER TABLE pos_tabs ADD CONSTRAINT pos_tabs_status_check CHECK (status IN ('open','held','settled','voided'));`);

    // FBR e-invoicing hook (step 19) — schema-ready, deliberately unpopulated.
    // No direct FBR integration is built here; this just avoids a breaking
    // schema change whenever a licensed integrator (PRAL etc.) is connected.
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fbr_invoice_number VARCHAR(50);`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fbr_qr_code_url TEXT;`);

    // ── impl-12 (2026-08-28 research-strengthened) — coupons/discounts extended,
    // referral program. The `coupons` table already existed (built for impl-15/21
    // before a written spec existed) with discount_type IN ('percent','fixed') —
    // kept those column/enum names rather than renaming to the spec's
    // 'type'/'percentage'/'flat' to avoid breaking the already-verified
    // race-safe redemption path; only ADD what's new. ──
    await client.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount_amount NUMERIC(10,2);`);
    await client.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS referral_customer_id UUID REFERENCES customers(id);`);
    await client.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;`);
    // Extend discount_type with 'free_delivery' and 'bogo' — value is NULL for
    // both (bogo's discount is computed from the cheapest cart line at
    // redemption time; there is no separate "target item" concept specced).
    // Original column was VARCHAR(10), too narrow for 'free_delivery' (13
    // chars) — a real bug caught live on first test (insert failed with
    // "value too long"), fixed by widening it here rather than shortening
    // the value.
    await client.query(`ALTER TABLE coupons ALTER COLUMN discount_type TYPE VARCHAR(20);`);
    await client.query(`ALTER TABLE coupons ALTER COLUMN discount_value DROP NOT NULL;`);
    await client.query(`ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;`);
    await client.query(`ALTER TABLE coupons ADD CONSTRAINT coupons_discount_type_check CHECK (discount_type IN ('percent','fixed','free_delivery','bogo'));`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        referrer_customer_id    UUID NOT NULL REFERENCES customers(id),
        referred_customer_id    UUID REFERENCES customers(id),
        referrer_coupon_id      UUID REFERENCES coupons(id),
        referred_coupon_id      UUID REFERENCES coupons(id),
        status                  VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired')),
        created_at              TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(tenant_id, referrer_customer_id);`);
    // Deliberately NOT unique on referred_coupon_id: one referrer's reusable
    // code can be redeemed by many different friends over time — each
    // successful referral gets its own row (referred_customer_id differs).
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_coupon ON referral_rewards(referred_coupon_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_pending ON referral_rewards(tenant_id, referred_customer_id, status);`);

    // ── impl-25 branch analytics — branch-access scoping (minimal version;
    // impl-10's RBAC is role-based only, no branch dimension, so this is
    // genuinely new rather than a duplicate). Design decision (stated
    // up front per the spec): HARD-LOCKED access — a manager/staff account
    // sees only branches they're explicitly granted, not just a UI default,
    // per the spec's own recommendation and this project's established
    // tenant-isolation discipline. Owner always sees every branch (checked
    // by role, no rows needed, same shape as authorize()'s owner bypass). ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_branch_access (
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, branch_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_branch_access_user ON user_branch_access(user_id);`);

    // Seed every EXISTING non-owner user with access to every branch their
    // tenant currently has — hard-locking is a brand-new restriction with
    // no prior enforcement to preserve, so without this every manager/staff
    // account would silently lose all branch visibility the moment this
    // ships (the exact "accidental lockout" class of bug flagged as a risk
    // in impl-10's own verification steps). New non-owner accounts created
    // from here on start with zero branches until explicitly assigned
    // (staff-invites.js grants the invited branch on accept — see there).
    await client.query(`
      INSERT INTO user_branch_access (user_id, branch_id)
      SELECT u.id, b.id FROM users u
      JOIN branches b ON b.tenant_id = u.tenant_id
      WHERE u.role != 'owner'
      ON CONFLICT (user_id, branch_id) DO NOTHING;
    `);

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
