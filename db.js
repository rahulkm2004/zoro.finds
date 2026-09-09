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
    }
  }
  return dbInstance;
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
 * Check product availability considering 1-of-1 status and active session reservations
 */
function checkProductsAvailability(productIds, sessionId = null) {
  const db = getDb();
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { available: true, soldItems: [], reservedItems: [] };
  }

  purgeExpiredReservations(db);
  const now = new Date().toISOString();

  const soldItems = [];
  const reservedItems = [];

  for (const pid of productIds) {
    const product = db.prepare('SELECT id, product_name, status, numeric_price, price FROM products WHERE id = ?').get(pid);
    if (!product || product.status !== 'AVAILABLE') {
      soldItems.push({
        id: pid,
        name: product?.product_name || pid,
        status: product?.status || 'SOLD_OUT',
        message: 'Sorry, this item has just sold out.'
      });
      continue;
    }

    // Check if reserved by another session
    let resQuery = "SELECT id, session_id, expires_at FROM product_reservations WHERE product_id = ? AND status = 'ACTIVE' AND expires_at > ?";
    const resParams = [pid, now];
    if (sessionId) {
      resQuery += " AND session_id != ?";
      resParams.push(sessionId);
    }

    const activeRes = db.prepare(resQuery).get(...resParams);
    if (activeRes) {
      reservedItems.push({
        id: pid,
        name: product.product_name,
        expires_at: activeRes.expires_at,
        message: 'Sorry, this item is currently being purchased by another customer.'
      });
    }
  }

  return {
    available: (soldItems.length === 0 && reservedItems.length === 0),
    soldItems,
    reservedItems
  };
}

/**
 * Acquire temporary 10-minute server-side checkout reservations in database
 */
function acquireProductReservations(productIds, sessionId, durationMinutes = 10) {
  const db = getDb();
  if (!sessionId) throw new Error('Session ID is required for checkout reservation');
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { success: true, expires_at: null };
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  db.exec('BEGIN TRANSACTION;');

  try {
    purgeExpiredReservations(db);

    // 1. Verify availability and no competing active reservations
    for (const pid of productIds) {
      const product = db.prepare('SELECT id, product_name, status FROM products WHERE id = ?').get(pid);
      if (!product || product.status !== 'AVAILABLE') {
        throw new Error(`SOLD_OUT:${pid}:${product?.product_name || pid}`);
      }

      const competing = db.prepare(
        "SELECT id, session_id, expires_at FROM product_reservations WHERE product_id = ? AND status = 'ACTIVE' AND expires_at > ? AND session_id != ?"
      ).get(pid, now, sessionId);

      if (competing) {
        throw new Error(`RESERVED:${pid}:${product.product_name}`);
      }
    }

    // 2. Insert or update active reservation for each item under this session
    for (const pid of productIds) {
      // Deactivate any existing active reservation for this session/product
      db.prepare("UPDATE product_reservations SET status = 'EXPIRED', updated_at = ? WHERE product_id = ? AND session_id = ? AND status = 'ACTIVE'")
        .run(now, pid, sessionId);

      const resId = 'RES_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      db.prepare(`
        INSERT INTO product_reservations (
          id, product_id, session_id, reserved_at, expires_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
      `).run(resId, pid, sessionId, now, expiresAt, now, now);
    }

    db.exec('COMMIT;');

    return {
      success: true,
      expires_at: expiresAt,
      session_id: sessionId,
      product_ids: productIds
    };
  } catch (err) {
    db.exec('ROLLBACK;');
    if (err.message.startsWith('SOLD_OUT:')) {
      const [, pid, name] = err.message.split(':');
      return {
        success: false,
        reason: 'SOLD_OUT',
        product_id: pid,
        product_name: name,
        error: 'Sorry, this item has just sold out.'
      };
    }
    if (err.message.startsWith('RESERVED:')) {
      const [, pid, name] = err.message.split(':');
      return {
        success: false,
        reason: 'RESERVED',
        product_id: pid,
        product_name: name,
        error: 'Sorry, this item is currently being purchased by another customer.'
      };
    }
    throw err;
  }
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

  const productIds = (orderData.products || []).map(p => p.id).filter(Boolean);
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
        const updateStmt = db.prepare("UPDATE products SET status = 'SOLD_OUT', updated_at = ? WHERE id = ? AND status = 'AVAILABLE'");
        const result = updateStmt.run(now, pid);
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
        razorpay_payment_id, advance_amount, remaining_amount, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

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
      typeof orderData.products === 'string' ? orderData.products : JSON.stringify(orderData.products || []),
      typeof orderData.shipping_charge === 'number' ? orderData.shipping_charge : (orderData.payment_method === 'COD' ? 100 : 0),
      orderData.total_amount || 0,
      orderData.payment_method || 'ONLINE',
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
  getOrderByPaymentId,
  getAllOrders
};
