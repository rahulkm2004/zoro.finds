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
  // API ROUTE: POST /api/create-order
  // Checks product availability in D1 and creates a secure Razorpay order
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/create-order') {
    try {
      const data = await parseBody(req);
      const items = data.items || [];
      const customer = data.customer || {};

      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, {
          error: 'Invalid or empty items list'
        });
      }

      // DOUBLE PURCHASE PROTECTION: Check product availability in database
      const itemIds = items.map(i => i.id).filter(Boolean);
      const availCheck = db.checkProductsAvailability(itemIds);

      if (!availCheck.available) {
        return sendJSON(res, 400, {
          error: 'Sorry, this item has just sold out.',
          sold_items: availCheck.soldItems
        });
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
  // Secure HMAC-SHA256 signature verification + Atomic D1 Order & Sold Out Update
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
  // STATIC FILE SERVING WITH VIDEO STREAMING (HTTP 206)
  // -------------------------------------------------------------------------
  let reqPath = decodeURIComponent(pathname);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(__dirname, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileSize = stats.size;

    // Handle Range requests for video streaming
    const range = req.headers.range;
    if (range && (ext === '.mp4' || ext === '.webm' || ext === '.mov')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log('ZORO.FINDS server with D1 SQLite database & Razorpay running at http://localhost:' + PORT);
});
