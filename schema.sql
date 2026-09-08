-- =========================================================================
-- CLOUDFLARE D1 DATABASE SCHEMA FOR ZORO.FINDS
-- Permanent database for Products, Availability, Orders & Razorpay Payments
-- =========================================================================

-- Products Table (1-of-1 Thrift Archive Collection)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('HOODIES', 'JACKETS')),
  price TEXT NOT NULL,
  numeric_price REAL NOT NULL,
  description TEXT,
  images TEXT NOT NULL,       -- JSON Array of image paths
  sizes TEXT,                 -- JSON Array of available sizes
  display_size TEXT,          -- Display size label (e.g. L, XL, M)
  chest TEXT,                 -- Measurement: Chest width
  length TEXT,                -- Measurement: Length
  condition TEXT,             -- Condition grade (e.g. 9/10, 8.5/10)
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE', 'SOLD_OUT', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- Orders Table (Customer Checkout, Payment Verification & Remaining COD Balance)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  shipping_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  products TEXT NOT NULL,      -- JSON Array of purchased product line items
  shipping_charge REAL DEFAULT 0,
  total_amount REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('ONLINE', 'COD')),
  payment_status TEXT NOT NULL CHECK(payment_status IN ('PENDING', 'PAID', 'ADVANCE_PAID', 'FAILED')),
  order_status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(order_status IN ('CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  advance_amount REAL DEFAULT 0,
  remaining_amount REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
