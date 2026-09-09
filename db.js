/**
 * Database Module for ZORO.FINDS
 * Uses node:sqlite DatabaseSync for local Node.js server
 * and provides equivalent transaction semantics to Cloudflare D1.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'zoro_d1.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEED_PATH = path.join(__dirname, 'seed_d1.sql');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    const isNew = !fs.existsSync(DB_PATH);
    dbInstance = new DatabaseSync(DB_PATH);
    
    // Enable WAL mode and foreign keys for high performance and integrity
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');

    if (isNew || shouldInit()) {
      initDatabase(dbInstance);
    } else {
      applyMigrations(dbInstance);
    }
  }
  return dbInstance;
}

function applyMigrations(db) {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const hasAdminEmailSent = tableInfo.some(col => col.name === 'admin_email_sent');
    if (!hasAdminEmailSent) {
      db.exec("ALTER TABLE orders ADD COLUMN admin_email_sent INTEGER DEFAULT 0;");
      db.exec("ALTER TABLE orders ADD COLUMN admin_email_sent_at TEXT;");
    }
    const hasCustomerEmailSent = tableInfo.some(col => col.name === 'customer_email_sent');
    if (!hasCustomerEmailSent) {
      db.exec("ALTER TABLE orders ADD COLUMN customer_email_sent INTEGER DEFAULT 0;");
      db.exec("ALTER TABLE orders ADD COLUMN customer_email_sent_at TEXT;");
    }

    const prodInfo = db.prepare("PRAGMA table_info(products)").all();
    const hasSaleSource = prodInfo.some(col => col.name === 'sale_source');
    if (!hasSaleSource) {
      db.exec("ALTER TABLE products ADD COLUMN sale_source TEXT DEFAULT NULL;");
    }
    const hasSoldAt = prodInfo.some(col => col.name === 'sold_at');
    if (!hasSoldAt) {
      db.exec("ALTER TABLE products ADD COLUMN sold_at TEXT DEFAULT NULL;");
    }
  } catch (e) {}
}

function shouldInit() {
  try {
    const stmt = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
    const row = stmt.get();
    return !row;
  } catch (e) {
    return true;
  }
}

function initDatabase(db) {
  const targetDb = db || (dbInstance || new DatabaseSync(DB_PATH));
  console.log('Initializing local SQLite database with schema.sql and seed_d1.sql...');
  if (fs.existsSync(SCHEMA_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    targetDb.exec(schema);
  }
  if (fs.existsSync(SEED_PATH)) {
    const seed = fs.readFileSync(SEED_PATH, 'utf8');
    targetDb.exec(seed);
  }
  console.log('✓ Database initialized successfully.');
}

/**
 * Get all products or filter by category / status
 */
function getAllProducts(options = {}) {
  const db = getDb();
  let query = 'SELECT * FROM products';
  const params = [];
  const conditions = [];

  if (options.category) {
    conditions.push('category = ?');
    params.push(options.category.toUpperCase());
  }

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status.toUpperCase());
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC, id DESC';

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);

  return rows.map(row => ({
    ...row,
    images: typeof row.images === 'string' ? JSON.parse(row.images) : row.images,
    sizes: typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes
  }));
}

/**
 * Get single product by ID
 */
function getProductById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM products WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;

  return {
    ...row,
    images: typeof row.images === 'string' ? JSON.parse(row.images) : row.images,
    sizes: typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes
  };
}

/**
 * Purge or mark expired active reservations
 */
function purgeExpiredReservations(db) {
  const now = new Date().toISOString();
  db.prepare("UPDATE product_reservations SET status = 'EXPIRED', updated_at = ? WHERE status = 'ACTIVE' AND expires_at <= ?")
    .run(now, now);
}

/**
 * Check product availability considering 1-of-1 status
 */
function checkProductsAvailability(productIds) {
  const db = getDb();
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { available: true, soldItems: [] };
  }

  const soldItems = [];

  for (const pid of productIds) {
    const product = db.prepare('SELECT id, product_name, status, numeric_price, price FROM products WHERE id = ?').get(pid);
    if (!product || product.status !== 'AVAILABLE') {
      soldItems.push({
        id: pid,
        name: product?.product_name || pid,
        status: product?.status || 'SOLD_OUT',
        message: 'Sorry, this item has just sold out.'
      });
    }
  }

  return {
    available: (soldItems.length === 0),
    soldItems,
    reservedItems: []
  };
}

/**
 * Compatibility helper for reservations (no blocking prior to payment)
 */
function acquireProductReservations(productIds, sessionId) {
  return { success: true, expires_at: null, session_id: sessionId, product_ids: productIds };
}

/**
 * Release active reservation for a session
 */
function releaseProductReservations(sessionId, productIds = null) {
  const db = getDb();
  if (!sessionId) return { success: true };

  const now = new Date().toISOString();
  if (Array.isArray(productIds) && productIds.length > 0) {
    for (const pid of productIds) {
      db.prepare("UPDATE product_reservations SET status = 'CANCELLED', updated_at = ? WHERE session_id = ? AND product_id = ? AND status = 'ACTIVE'")
        .run(now, sessionId, pid);
    }
  } else {
    db.prepare("UPDATE product_reservations SET status = 'CANCELLED', updated_at = ? WHERE session_id = ? AND status = 'ACTIVE'")
      .run(now, sessionId);
  }

  return { success: true };
}

/**
 * Atomically creates an order in D1 / SQLite, completes reservations, and marks product(s) SOLD_OUT.
 * Protects against double-purchase concurrency.
 */
function confirmOrderAndMarkSoldOut(orderData) {
  const db = getDb();
  const now = new Date().toISOString();

  const rawProducts = orderData.products || orderData.items || [];
  const productIds = rawProducts.map(p => p.id).filter(Boolean);
  const sessionId = orderData.session_id || orderData.sessionId || null;

  // Run in a transaction
  db.exec('BEGIN TRANSACTION;');

  try {
    // 1. Idempotency Check: if razorpay_payment_id already confirmed an order, return existing
    if (orderData.razorpay_payment_id) {
      const existing = db.prepare('SELECT id, order_number FROM orders WHERE razorpay_payment_id = ?').get(orderData.razorpay_payment_id);
      if (existing) {
        db.exec('COMMIT;');
        return {
          success: true,
          idempotent: true,
          order_id: existing.id,
          order_number: existing.order_number
        };
      }
    }

    // 2. Double check and atomically claim products with conditional UPDATE
    if (productIds.length > 0) {
      for (const pid of productIds) {
        const updateStmt = db.prepare("UPDATE products SET status = 'SOLD_OUT', sale_source = 'WEBSITE', sold_at = ?, updated_at = ? WHERE id = ? AND status = 'AVAILABLE'");
        const result = updateStmt.run(now, now, pid);
        if (result.changes === 0) {
          throw new Error('Sorry, this item has just sold out.');
        }

        // Complete any active reservation for this product
        if (sessionId) {
          db.prepare("UPDATE product_reservations SET status = 'COMPLETED', updated_at = ? WHERE product_id = ? AND session_id = ? AND status = 'ACTIVE'")
            .run(now, pid, sessionId);
        } else {
          db.prepare("UPDATE product_reservations SET status = 'COMPLETED', updated_at = ? WHERE product_id = ? AND status = 'ACTIVE'")
            .run(now, pid);
        }
      }
    }

    // 3. Insert Order Record
    const orderId = orderData.id || ('ORD_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    const orderNumber = orderData.order_number || ('ZF-' + Date.now().toString().slice(-6));

    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_name, customer_phone, customer_email,
        shipping_address, city, state, pincode, products, shipping_charge, total_amount,
        payment_method, payment_status, order_status, razorpay_order_id,
        razorpay_payment_id, advance_amount, remaining_amount, admin_email_sent, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, 0, ?, ?
      )
    `);

    const paymentMethodUpper = (orderData.payment_method || 'ONLINE').toUpperCase();
    insertOrderStmt.run(
      orderId,
      orderNumber,
      orderData.customer_name || orderData.customer?.name || 'Customer',
      orderData.customer_phone || orderData.customer?.phone || '',
      orderData.customer_email || orderData.customer?.email || '',
      orderData.shipping_address || orderData.customer?.address || '',
      orderData.city || orderData.customer?.city || '',
      orderData.state || orderData.customer?.state || '',
      orderData.pincode || orderData.customer?.pincode || '',
      typeof rawProducts === 'string' ? rawProducts : JSON.stringify(rawProducts),
      typeof orderData.shipping_charge === 'number' ? orderData.shipping_charge : (paymentMethodUpper === 'COD' ? 100 : 0),
      orderData.total_amount || 0,
      paymentMethodUpper,
      orderData.payment_status || 'PAID',
      orderData.order_status || 'CONFIRMED',
      orderData.razorpay_order_id || null,
      orderData.razorpay_payment_id || null,
      orderData.advance_amount || 0,
      orderData.remaining_amount || 0,
      now,
      now
    );

    db.exec('COMMIT;');

    return {
      success: true,
      order_id: orderId,
      order_number: orderNumber
    };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Mark admin email as sent for an order
 */
function markOrderEmailSent(orderId) {
  if (!orderId) return;
  const db = getDb();
  const now = new Date().toISOString();
  try {
    db.prepare('UPDATE orders SET admin_email_sent = 1, admin_email_sent_at = ? WHERE id = ?').run(now, orderId);
  } catch (e) {
    // If column missing in existing SQLite file, alter table
    try {
      db.prepare('ALTER TABLE orders ADD COLUMN admin_email_sent INTEGER DEFAULT 0').run();
      db.prepare('ALTER TABLE orders ADD COLUMN admin_email_sent_at TEXT').run();
      db.prepare('UPDATE orders SET admin_email_sent = 1, admin_email_sent_at = ? WHERE id = ?').run(now, orderId);
    } catch (err) {}
  }
}

/**
 * Mark customer email as sent for an order
 */
function markCustomerEmailSent(orderId) {
  if (!orderId) return;
  const db = getDb();
  const now = new Date().toISOString();
  try {
    db.prepare('UPDATE orders SET customer_email_sent = 1, customer_email_sent_at = ? WHERE id = ?').run(now, orderId);
  } catch (e) {
    try {
      db.prepare('ALTER TABLE orders ADD COLUMN customer_email_sent INTEGER DEFAULT 0').run();
      db.prepare('ALTER TABLE orders ADD COLUMN customer_email_sent_at TEXT').run();
      db.prepare('UPDATE orders SET customer_email_sent = 1, customer_email_sent_at = ? WHERE id = ?').run(now, orderId);
    } catch (err) {}
  }
}

/**
 * Get order by Razorpay payment ID for idempotency check
 */
function getOrderByPaymentId(paymentId) {
  if (!paymentId) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM orders WHERE razorpay_payment_id = ?').get(paymentId);
  if (!row) return null;
  return {
    ...row,
    products: typeof row.products === 'string' ? JSON.parse(row.products) : row.products
  };
}

/**
 * Admin: Add a new product (Jacket or Hoodie)
 */
function addProduct(data) {
  const db = getDb();
  const id = (data.id || data.product_id || '').trim();
  if (!id) {
    throw new Error('Product ID is required.');
  }

  // Duplicate check
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (existing) {
    throw new Error('Product ID already exists.');
  }

  const category = (data.category || 'JACKETS').toUpperCase();
  if (category !== 'JACKETS' && category !== 'HOODIES') {
    throw new Error('Category must be either JACKETS or HOODIES.');
  }

  let numericPrice = typeof data.numeric_price === 'number' ? data.numeric_price : parseFloat(data.price?.replace(/[^0-9.]/g, '')) || 0;
  let formattedPrice = data.price ? data.price : ('₹' + numericPrice.toLocaleString('en-IN'));

  const now = new Date().toISOString();
  const images = Array.isArray(data.images) ? JSON.stringify(data.images) : (typeof data.images === 'string' ? data.images : '[]');
  const sizes = Array.isArray(data.sizes) ? JSON.stringify(data.sizes) : (typeof data.sizes === 'string' ? data.sizes : JSON.stringify([data.display_size || 'Free Size']));

  const stmt = db.prepare(`
    INSERT INTO products (
      id, product_name, category, price, numeric_price, description,
      images, sizes, display_size, chest, length, condition,
      status, sale_source, sold_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id,
    data.product_name || data.name || 'Curated Vintage Item',
    category,
    formattedPrice,
    numericPrice,
    data.description || '',
    images,
    sizes,
    data.display_size || data.size || 'Free Size',
    data.chest || '',
    data.length || '',
    data.condition || '9/10',
    data.status || 'AVAILABLE',
    data.sale_source || null,
    data.sold_at || null,
    data.created_at || now,
    now
  );

  return getProductById(id);
}

/**
 * Admin: Update product status (e.g. SOLD_OUT with INSTAGRAM_DM or restore to AVAILABLE)
 */
function updateProductStatus(productId, status, saleSource = null) {
  const db = getDb();
  const id = (productId || '').trim();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) {
    throw new Error('Product not found.');
  }

  const targetStatus = (status || 'AVAILABLE').toUpperCase();
  const now = new Date().toISOString();

  let finalSaleSource = null;
  let finalSoldAt = null;

  if (targetStatus === 'SOLD_OUT') {
    finalSaleSource = saleSource || product.sale_source || 'MANUAL';
    finalSoldAt = product.sold_at || now;
  } else if (targetStatus === 'AVAILABLE') {
    finalSaleSource = null;
    finalSoldAt = null;
  } else if (targetStatus === 'ARCHIVED') {
    finalSaleSource = product.sale_source;
    finalSoldAt = product.sold_at;
  }

  db.prepare(`
    UPDATE products 
    SET status = ?, sale_source = ?, sold_at = ?, updated_at = ? 
    WHERE id = ?
  `).run(targetStatus, finalSaleSource, finalSoldAt, now, id);

  return getProductById(id);
}

/**
 * Admin: Delete a product
 */
function deleteProduct(productId) {
  const db = getDb();
  const id = (productId || '').trim();
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  return info.changes > 0;
}

/**
 * Admin: Get all products with full status, sale source, and linked order ID
 */
function getAllProductsForAdmin() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT p.*, o.id as linked_order_id, o.order_number as linked_order_number, o.customer_name as linked_customer_name
    FROM products p
    LEFT JOIN orders o ON o.products LIKE '%' || p.id || '%'
    ORDER BY p.created_at DESC, p.id DESC
  `);
  const rows = stmt.all();

  return rows.map(r => ({
    ...r,
    images: typeof r.images === 'string' ? JSON.parse(r.images) : r.images,
    sizes: typeof r.sizes === 'string' ? JSON.parse(r.sizes) : r.sizes
  }));
}

/**
 * Get all orders
 */
function getAllOrders() {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM orders ORDER BY created_at DESC');
  const rows = stmt.all();
  return rows.map(r => ({
    ...r,
    products: typeof r.products === 'string' ? JSON.parse(r.products) : r.products
  }));
}

module.exports = {
  getDb,
  initDatabase,
  getAllProducts,
  getProductById,
  checkProductsAvailability,
  acquireProductReservations,
  releaseProductReservations,
  confirmOrderAndMarkSoldOut,
  markOrderEmailSent,
  markCustomerEmailSent,
  getOrderByPaymentId,
  getAllOrders,
  addProduct,
  updateProductStatus,
  deleteProduct,
  getAllProductsForAdmin
};
