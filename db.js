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
  console.log('Initializing local SQLite database with schema.sql and seed_d1.sql...');
  if (fs.existsSync(SCHEMA_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  if (fs.existsSync(SEED_PATH)) {
    const seed = fs.readFileSync(SEED_PATH, 'utf8');
    db.exec(seed);
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

  query += ' ORDER BY id ASC';

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
 * Check if all given product IDs are AVAILABLE
 * Returns { available: boolean, soldItems: string[] }
 */
function checkProductsAvailability(productIds) {
  const db = getDb();
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { available: true, soldItems: [] };
  }

  const placeholders = productIds.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT id, product_name, status FROM products WHERE id IN (${placeholders})`);
  const rows = stmt.all(...productIds);

  const foundIds = new Set(rows.map(r => r.id));
  const soldItems = [];

  for (const pid of productIds) {
    if (!foundIds.has(pid)) {
      soldItems.push({ id: pid, name: pid, reason: 'Item not found in catalog' });
      continue;
    }
    const product = rows.find(r => r.id === pid);
    if (product.status !== 'AVAILABLE') {
      soldItems.push({ id: pid, name: product.product_name, status: product.status });
    }
  }

  return {
    available: soldItems.length === 0,
    soldItems
  };
}

/**
 * Atomically creates an order in D1 / SQLite and marks product(s) SOLD_OUT.
 * Protects against double-purchase concurrency.
 */
function confirmOrderAndMarkSoldOut(orderData) {
  const db = getDb();
  const now = new Date().toISOString();

  const productIds = (orderData.products || []).map(p => p.id).filter(Boolean);

  // Run in a transaction
  db.exec('BEGIN TRANSACTION;');

  try {
    // 1. Double check and atomically claim products with conditional UPDATE
    if (productIds.length > 0) {
      for (const pid of productIds) {
        const updateStmt = db.prepare("UPDATE products SET status = 'SOLD_OUT', updated_at = ? WHERE id = ? AND status = 'AVAILABLE'");
        const result = updateStmt.run(now, pid);
        if (result.changes === 0) {
          throw new Error('Sorry, this item has just sold out.');
        }
      }
    }

    // 2. Insert Order Record
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
  confirmOrderAndMarkSoldOut,
  getAllOrders
};
