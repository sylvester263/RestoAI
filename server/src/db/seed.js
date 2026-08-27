import pool from './pool.js';
import bcrypt from 'bcryptjs';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Demo tenant ──
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, slug, phone, address)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `, ['Lahore Karahi House', 'lahore-karahi', '+923001234567', 'MM Alam Road, Gulberg III, Lahore']);
    const tenantId = tenantRes.rows[0].id;

    // ── Demo owner user ──
    const passwordHash = await bcrypt.hash('demo1234', 10);
    await client.query(`
      INSERT INTO users (tenant_id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING;
    `, [tenantId, 'Ahmed Malik', 'ahmed@karahi.pk', passwordHash, 'owner']);

    // ── Demo staff user ──
    const staffHash = await bcrypt.hash('staff1234', 10);
    await client.query(`
      INSERT INTO users (tenant_id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING;
    `, [tenantId, 'Bilal Staff', 'bilal@karahi.pk', staffHash, 'staff']);

    // ── Main branch ──
    const branchRes = await client.query(`
      INSERT INTO branches (tenant_id, name, address, phone)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `, [tenantId, 'Gulberg Main', 'MM Alam Road, Gulberg III, Lahore', '+923001234567']);
    const branchId = branchRes.rows[0].id;

    // ── Menu categories ──
    const categories = [
      ['Karahi', 1], ['BBQ', 2], ['Naan & Roti', 3], ['Rice', 4],
      ['Drinks', 5], ['Desserts', 6],
    ];
    const catIds = {};
    for (const [name, order] of categories) {
      const res = await client.query(`
        INSERT INTO menu_categories (tenant_id, branch_id, name, sort_order)
        VALUES ($1, $2, $3, $4)
        RETURNING id;
      `, [tenantId, branchId, name, order]);
      catIds[name] = res.rows[0].id;
    }

    // ── Menu items ──
    const items = [
      ['Chicken Karahi', 'چکن کڑاہی', 'Fresh chicken cooked in tomato-based gravy with green chilies', 1200, 'Karahi'],
      ['Mutton Karahi', 'مٹن کڑاہی', 'Tender mutton in rich spices and yogurt base', 1800, 'Karahi'],
      ['Daal Karahi', 'دال کڑاہی', 'Mixed lentils tempered with desi ghee', 700, 'Karahi'],
      ['Seekh Kebab (4pc)', 'سیخ کباب', 'Charcoal-grilled minced meat kebabs', 600, 'BBQ'],
      ['Chicken Tikka (Half)', 'چکن ٹکہ', 'Marinated boneless chicken, tandoor-grilled', 900, 'BBQ'],
      ['Malai Boti (8pc)', 'ملائی بوٹی', 'Creamy marinated chicken pieces', 850, 'BBQ'],
      ['Tandoori Naan', 'تندوری نان', 'Classic clay-oven flatbread', 40, 'Naan & Roti'],
      ['Garlic Naan', 'گارلک نان', 'Naan topped with garlic and butter', 80, 'Naan & Roti'],
      ['Roghni Naan', 'روغنی نان', 'Sweet oil-based traditional naan', 60, 'Naan & Roti'],
      ['Chicken Biryani', 'چکن بریانی', 'Fragrant basmati rice with spiced chicken', 450, 'Rice'],
      ['Mutton Pulao', 'مٹن پلاؤ', 'Slow-cooked rice with mutton and whole spices', 550, 'Rice'],
      ['Zeera Rice', 'زیرہ رائس', 'Cumin-flavored steamed rice', 250, 'Rice'],
      ['Lassi (Sweet)', 'لسی', 'Traditional yogurt drink, sweet', 150, 'Drinks'],
      ['Mint Raita', 'رائتا', 'Cool yogurt with fresh mint', 100, 'Drinks'],
      ['Fresh Lime Soda', 'لائم سوڈا', 'Refreshing lime with soda water', 120, 'Drinks'],
      ['Gulab Jamun (2pc)', 'گلاب جامن', 'Deep-fried milk dumplings in rose syrup', 200, 'Desserts'],
      ['Kheer', 'کھیر', 'Slow-cooked rice pudding with cardamom', 250, 'Desserts'],
    ];

    for (const [name, urdu, desc, price, cat] of items) {
      await client.query(`
        INSERT INTO menu_items (tenant_id, branch_id, category_id, name, name_urdu, description, price, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
      `, [tenantId, branchId, catIds[cat], name, urdu, desc, price, [cat.toLowerCase()]]);
    }

    // ── Loyalty config (enable for demo) ──
    await client.query(`
      INSERT INTO loyalty_config (tenant_id, points_per_currency_unit, redemption_rate, enabled)
      VALUES ($1, 1.0, 0.01, true)
      ON CONFLICT (tenant_id) DO UPDATE SET enabled = true;
    `, [tenantId]);

    // ── Demo customers ──
    const cust1 = await client.query(`
      INSERT INTO customers (tenant_id, phone, name, address, order_count, total_spent)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
      RETURNING id;
    `, [tenantId, '+923001111111', 'Usman Tariq', 'House 12, Block D, DHA Phase 5', 8, 9600]);
    const cust2 = await client.query(`
      INSERT INTO customers (tenant_id, phone, name, address, order_count, total_spent)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
      RETURNING id;
    `, [tenantId, '+923221234567', 'Fatima Noor', 'Flat 4B, Gulberg Centre', 3, 3450]);

    // ── Demo orders (last 7 days) ──
    const now = new Date();
    const statuses = ['delivered', 'delivered', 'delivered', 'preparing', 'new'];
    for (let d = 0; d < 7; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      const ordersPerDay = Math.floor(Math.random() * 3) + 1;
      for (let o = 0; o < ordersPerDay; o++) {
        const cust = Math.random() > 0.5 ? cust1 : cust2;
        const orderRes = await client.query(`
          INSERT INTO orders (tenant_id, branch_id, customer_id, channel, status, subtotal, tax, delivery_fee, total, delivery_address, payment_method, created_at)
          VALUES ($1, $2, $3, 'whatsapp', $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id;
        `, [
          tenantId, branchId, cust.rows[0].id,
          statuses[Math.floor(Math.random() * statuses.length)],
          800 + Math.floor(Math.random() * 1200),
          80 + Math.floor(Math.random() * 120),
          100,
          980 + Math.floor(Math.random() * 1420),
          cust.rows[0].id === cust1.rows[0].id ? 'House 12, Block D, DHA Phase 5' : 'Flat 4B, Gulberg Centre',
          ['cash', 'jazzcash', 'easypaisa'][Math.floor(Math.random() * 3)],
          date,
        ]);
        // Add random order items
        const numItems = Math.floor(Math.random() * 3) + 1;
        const demoItems = [
          ['Chicken Karahi', 1200], ['Mutton Karahi', 1800], ['Tandoori Naan', 40],
          ['Chicken Biryani', 450], ['Lassi (Sweet)', 150],
        ];
        for (let i = 0; i < numItems; i++) {
          const [name, price] = demoItems[Math.floor(Math.random() * demoItems.length)];
          const qty = Math.floor(Math.random() * 2) + 1;
          await client.query(`
            INSERT INTO order_items (order_id, name, quantity, unit_price, total_price)
            VALUES ($1, $2, $3, $4, $5);
          `, [orderRes.rows[0].id, name, qty, price, price * qty]);
        }
      }
    }

    // ── Demo ingredients (impl-08) ──
    const ingredients = [
      ['Chicken (whole)', 'kg', 25, 5, 450], ['Mutton', 'kg', 10, 3, 1400],
      ['Tomatoes', 'kg', 30, 10, 80], ['Onions', 'kg', 40, 10, 60],
      ['Cooking Oil', 'litre', 15, 5, 550], ['Basmati Rice', 'kg', 50, 15, 280],
      ['Yogurt', 'kg', 8, 3, 220], ['Naan Dough', 'kg', 20, 5, 150],
    ];
    for (const [name, unit, stock, threshold, costPerUnit] of ingredients) {
      await client.query(`
        INSERT INTO ingredients (tenant_id, branch_id, name, unit, current_stock, low_stock_threshold, cost_per_unit)
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [tenantId, branchId, name, unit, stock, threshold, costPerUnit]);
    }

    await client.query('COMMIT');
    console.log('[seed] demo data seeded successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] seeding failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
