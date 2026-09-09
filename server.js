require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db.js');

let Razorpay;
try {
  Razorpay = require('razorpay');
} catch (e) {
  console.warn('Razorpay package not found, please run npm install razorpay');
}

const PORT = process.env.PORT || 3000;
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Helper to parse JSON request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON responses
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://' + req.headers.host);
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // -------------------------------------------------------------------------
  // API ROUTE: GET /api/config
  // Returns public Razorpay Key ID (never secret)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJSON(res, 200, {
      razorpay_key_id: process.env.RAZORPAY_KEY_ID || ''
    });
  }

  // -------------------------------------------------------------------------
  // API ROUTE: GET /api/products
  // Fetches live product catalogue from D1 / SQLite database
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/products') {
    try {
      const category = parsedUrl.searchParams.get('category');
      const status = parsedUrl.searchParams.get('status');
      const products = db.getAllProducts({ category, status });
      return sendJSON(res, 200, {
        success: true,
        count: products.length,
        products
      });
    } catch (err) {
      console.error('Error fetching products from database:', err.message);
      return sendJSON(res, 500, { error: 'Failed to fetch products: ' + err.message });
    }
  }

  // -------------------------------------------------------------------------
  // API ROUTE: GET /api/orders
  // Fetches confirmed orders from database
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/orders') {
    try {
      const orders = db.getAllOrders();
      return sendJSON(res, 200, {
        success: true,
        count: orders.length,
        orders
      });
    } catch (err) {
      console.error('Error fetching orders:', err.message);
      return sendJSON(res, 500, { error: 'Failed to fetch orders: ' + err.message });
    }
  }

  // -------------------------------------------------------------------------
  // API ROUTE: POST /api/reserve
  // Compatibility route
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/reserve') {
    return sendJSON(res, 200, { success: true, expires_at: null });
  }

  // -------------------------------------------------------------------------
  // API ROUTE: POST /api/release-reservation
  // Compatibility route
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/release-reservation') {
    return sendJSON(res, 200, { success: true });
  }

  // -------------------------------------------------------------------------
  // API ROUTE: POST /api/validate-cart
  // Validates cart items against real-time availability (AVAILABLE vs SOLD_OUT)
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/validate-cart') {
    try {
      const data = await parseBody(req);
      const items = data.items || [];
      const validatedItems = [];
      const soldItems = [];

      const itemIds = items.map(i => (typeof i === 'string' ? i : i.id)).filter(Boolean);
      const check = db.checkProductsAvailability(itemIds);

      for (const item of items) {
        const itemId = typeof item === 'string' ? item : item.id;
        const prod = db.getProductById(itemId);
        const isSold = check.soldItems.some(s => s.id === itemId);

        if (isSold) {
          soldItems.push(itemId);
          validatedItems.push({
            id: itemId,
            name: prod?.product_name || item.name || itemId,
            status: prod?.status || 'SOLD_OUT',
            numeric_price: prod?.numeric_price || item.numericPrice || 0,
            available: false,
            reason: 'SOLD_OUT',
            message: 'Sorry, this item has just sold out.'
          });
        } else {
          validatedItems.push({
            id: itemId,
            name: prod ? prod.product_name : (item.name || itemId),
            status: 'AVAILABLE',
            numeric_price: prod ? prod.numeric_price : (item.numericPrice || 0),
            price: prod ? prod.price : (item.price || '₹0'),
            available: true
          });
        }
      }

      return sendJSON(res, 200, {
        valid: (soldItems.length === 0),
        items: validatedItems,
        sold_items: soldItems,
        reserved_items: []
      });
    } catch (err) {
      console.error('Error in /api/validate-cart:', err.message);
      return sendJSON(res, 500, { error: 'Validation failed: ' + err.message });
    }
  }

  // -------------------------------------------------------------------------
  // API ROUTE: POST /api/create-order
  // Checks product availability / reservation and creates a secure Razorpay order
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/create-order') {
    try {
      const data = await parseBody(req);
      const items = data.items || [];
      const customer = data.customer || {};
      const sessionId = data.session_id || data.sessionId;

      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, { error: 'Invalid or empty items list' });
      }

      const itemIds = items.map(i => (typeof i === 'string' ? i : i.id)).filter(Boolean);

      // Re-acquire / extend temporary reservation for this session
      if (sessionId) {
        const resCheck = db.acquireProductReservations(itemIds, sessionId, 10);
        if (!resCheck.success) {
          return sendJSON(res, 400, resCheck);
        }
      } else {
        const availCheck = db.checkProductsAvailability(itemIds, sessionId);
        if (!availCheck.available) {
          const soldMsg = availCheck.soldItems.length > 0 ? 'Sorry, this item has just sold out.' : 'Sorry, this item is currently being purchased by another customer.';
          return sendJSON(res, 400, {
            error: soldMsg,
            sold_items: availCheck.soldItems,
            reserved_items: availCheck.reservedItems
          });
        }
      }

      // Calculate subtotal securely from database catalog
      let calculatedSubtotalRupees = 0;
      for (const item of items) {
        const prod = db.getProductById(item.id);
        let price = 0;
        if (prod && typeof prod.numeric_price === 'number') {
          price = prod.numeric_price;
        } else if (typeof item.price === 'number' && item.price > 0) {
          price = item.price;
        } else if (typeof item.price === 'string') {
          const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ''));
          if (!isNaN(parsed) && parsed > 0) price = parsed;
        }

        if (price <= 0) {
          return sendJSON(res, 400, {
            error: 'Invalid price for item: ' + (item.id || item.title || 'Unknown')
          });
        }

        calculatedSubtotalRupees += price;
      }

      const paymentMethod = data.payment_method === 'cod' ? 'cod' : 'online';
      const shippingChargeRupees = (paymentMethod === 'cod') ? 100 : 0;
      const calculatedTotalRupees = calculatedSubtotalRupees + shippingChargeRupees;

      let chargeRupees = calculatedTotalRupees;
      let advanceAmountRupees = calculatedTotalRupees;
      let remainingAmountRupees = 0;

      if (paymentMethod === 'cod') {
        if (calculatedSubtotalRupees < 200) {
          return sendJSON(res, 400, {
            error: 'Minimum order subtotal for Cash on Delivery is ₹200'
          });
        }
        chargeRupees = 200; // Mandatory ₹200 advance payment
        advanceAmountRupees = 200;
        remainingAmountRupees = calculatedTotalRupees - 200;
      }

      const amountInPaise = chargeRupees * 100;

      if (amountInPaise < 100) {
        return sendJSON(res, 400, {
          error: 'Order amount must be at least 100 paise (₹1)'
        });
      }

      const key_id = process.env.RAZORPAY_KEY_ID;
      const key_secret = process.env.RAZORPAY_KEY_SECRET;

      if (!key_id || !key_secret || key_id.includes('your_razorpay') || key_secret.includes('your_razorpay')) {
        return sendJSON(res, 401, {
          error: 'Razorpay API credentials not configured in .env file. Please add your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env'
        });
      }

      if (!Razorpay) {
        return sendJSON(res, 500, {
          error: 'Razorpay SDK is not initialized on server'
        });
      }

      const instance = new Razorpay({
        key_id: key_id,
        key_secret: key_secret
      });

      const receiptId = 'rcpt_' + Date.now().toString().slice(-8) + '_' + Math.floor(Math.random() * 1000);
      const orderOptions = {
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          session_id: sessionId || '',
          payment_method: paymentMethod,
          product_subtotal: '₹' + calculatedSubtotalRupees,
          shipping_charge: '₹' + shippingChargeRupees + (paymentMethod === 'cod' ? ' (COD Fee)' : ' (FREE)'),
          total_order_amount: '₹' + calculatedTotalRupees,
          advance_paid_amount: '₹' + advanceAmountRupees,
          remaining_cod_amount: '₹' + remainingAmountRupees,
          customer_name: (customer.name || '').slice(0, 40),
          customer_phone: (customer.phone || '').slice(0, 15),
          items_count: items.length.toString()
        }
      };

      const order = await instance.orders.create(orderOptions);

      return sendJSON(res, 200, {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency || 'INR',
        key_id: key_id,
        receipt: order.receipt,
        payment_method: paymentMethod,
        subtotal_amount: calculatedSubtotalRupees,
        shipping_charge: shippingChargeRupees,
        total_amount: calculatedTotalRupees,
        advance_amount: advanceAmountRupees,
        remaining_amount: remainingAmountRupees
      });
    } catch (err) {
      console.error('Error in /api/create-order:', err.message || err);
      const statusCode = err.statusCode || 500;
      return sendJSON(res, statusCode, {
        error: err.error?.description || err.message || 'Failed to create Razorpay order'
      });
    }
  }

  // -------------------------------------------------------------------------
  // API ROUTE: POST /api/verify-payment
  // Secure signature verification + Atomic D1 Order, Sold Out & Completed Reservation Update
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/verify-payment') {
    try {
      const data = await parseBody(req);
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return sendJSON(res, 400, {
          success: false,
          error: 'Missing required signature verification parameters'
        });
      }

      const key_secret = process.env.RAZORPAY_KEY_SECRET;
      if (!key_secret) {
        return sendJSON(res, 500, {
          success: false,
          error: 'Razorpay secret key not configured on server'
        });
      }

      const text = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', key_secret)
        .update(text)
        .digest('hex');

      const isMatch = (expectedSignature === razorpay_signature);

      if (!isMatch) {
        return sendJSON(res, 400, {
          success: false,
          error: 'Invalid payment signature. Verification failed.'
        });
      }

      const items = data.items || [];
      const customer = data.customer || {};
      const sessionId = data.session_id || data.sessionId || null;
      const paymentMethod = data.payment_method === 'cod' ? 'COD' : 'ONLINE';
      const paymentStatus = paymentMethod === 'COD' ? 'ADVANCE_PAID' : 'PAID';

      // Secure subtotal & shipping calculation on backend
      let subtotalAmount = 0;
      for (const item of items) {
        const prod = db.getProductById(item.id);
        let price = (prod && typeof prod.numeric_price === 'number') ? prod.numeric_price : item.numericPrice || item.price || 0;
        if (typeof price === 'string') price = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
        subtotalAmount += price;
      }
      const shippingCharge = paymentMethod === 'COD' ? 100 : 0;
      const totalAmount = subtotalAmount + shippingCharge;
      const advanceAmount = paymentMethod === 'COD' ? 200 : totalAmount;
      const remainingAmount = paymentMethod === 'COD' ? Math.max(0, totalAmount - 200) : 0;

      // ATOMIC TRANSACTION: Confirm order in D1 database and mark products SOLD_OUT
      let dbResult;
      try {
        dbResult = db.confirmOrderAndMarkSoldOut({
          products: items,
          session_id: sessionId,
          customer_name: customer.name || '',
          customer_phone: customer.phone || '',
          customer_email: customer.email || '',
          shipping_address: customer.address || '',
          city: customer.city || '',
          state: customer.state || '',
          pincode: customer.pincode || '',
          shipping_charge: shippingCharge,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          order_status: 'CONFIRMED',
          razorpay_order_id: razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id,
          advance_amount: advanceAmount,
          remaining_amount: remainingAmount
        });
      } catch (dbErr) {
        console.error('Database transaction error:', dbErr.message);
        return sendJSON(res, 400, {
          success: false,
          error: dbErr.message || 'Failed to record order in database'
        });
      }

      // Send Admin Notification Email via Mailjet (Guarded & Duplicate Protected)
      if (dbResult && dbResult.success) {
        const orderPayload = {
          id: dbResult.order_id,
          order_number: dbResult.order_number,
          customer_name: customer.name || '',
          customer_phone: customer.phone || '',
          customer_email: customer.email || '',
          shipping_address: customer.address || '',
          city: customer.city || '',
          state: customer.state || '',
          pincode: customer.pincode || '',
          products: items,
          subtotal_amount: subtotalAmount,
          shipping_charge: shippingCharge,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          order_status: 'CONFIRMED',
          razorpay_order_id: razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id,
          advance_amount: advanceAmount,
          remaining_amount: remainingAmount,
          created_at: new Date().toISOString()
        };

        try {
          import('./email-service.js').then(({ sendAdminOrderNotification }) => {
            sendAdminOrderNotification(orderPayload, process.env).then(emailRes => {
              if (emailRes && emailRes.success) {
                db.markOrderEmailSent(dbResult.order_id);
              }
            }).catch(err => {
              console.error('[Mailjet] Background email error:', err.message);
            });
          }).catch(err => {
            console.error('[Mailjet] Service load error:', err.message);
          });
        } catch (e) {
          console.error('[Mailjet] Email send invocation error:', e.message);
        }
      }

      return sendJSON(res, 200, {
        success: true,
        message: 'Payment verified and order confirmed in D1 database',
        order_id: dbResult.order_id,
        order_number: dbResult.order_number,
        payment_id: razorpay_payment_id,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        subtotal_amount: subtotalAmount,
        shipping_charge: shippingCharge,
        total_amount: totalAmount,
        advance_amount: advanceAmount,
        remaining_amount: remainingAmount
      });
    } catch (err) {
      console.error('Error in /api/verify-payment:', err.message || err);
      return sendJSON(res, 500, {
        success: false,
        error: 'Server error during payment verification'
      });
    }
  }

  // -------------------------------------------------------------------------
  // STATIC FILE HANDLER
  // Serves HTML, CSS, JS, Images, Videos from workspace
  // -------------------------------------------------------------------------
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('500 Internal Server Error');
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n====================================================`);
  console.log(`🚀 ZORO.FINDS Local Server running at http://localhost:${PORT}`);
  console.log(`💳 Razorpay Key ID: ${process.env.RAZORPAY_KEY_ID ? 'Configured (' + process.env.RAZORPAY_KEY_ID + ')' : 'NOT CONFIGURED'}`);
  console.log(`🗄️  D1 / SQLite DB: Connected (${path.join(__dirname, 'zoro_d1.sqlite')})`);
  console.log(`====================================================\n`);
});
