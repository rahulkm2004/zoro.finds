/**
 * Cloudflare Worker / Pages Functions Handler for ZORO.FINDS
 * Integrates Cloudflare D1 Database (binding: env.DB)
 * Permanent database for Products, Availability, Orders, and Razorpay Payments.
 */

// Helper: JSON response with CORS headers
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// Helper: Verify Razorpay HMAC-SHA256 signature on Cloudflare Edge Runtime
async function verifyRazorpaySignature(orderId, paymentId, signature, secret) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = enc.encode(`${orderId}|${paymentId}`);
  const signatureBytes = await crypto.subtle.sign('HMAC', key, data);
  const hashArray = Array.from(new Uint8Array(signatureBytes));
  const generatedSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return generatedSignature.toLowerCase() === signature.toLowerCase();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // =========================================================================
    // API ROUTE: GET /api/config
    // Returns public Razorpay Key ID
    // =========================================================================
    if (request.method === 'GET' && pathname === '/api/config') {
      return jsonResponse({
        razorpay_key_id: env.RAZORPAY_KEY_ID || ''
      });
    }

    // =========================================================================
    // API ROUTE: GET /api/products
    // Fetches live product catalogue from Cloudflare D1
    // =========================================================================
    if (request.method === 'GET' && pathname === '/api/products') {
      if (!env.DB) {
        return jsonResponse({ error: 'Cloudflare D1 Database binding (env.DB) is not configured.' }, 500);
      }

      try {
        const category = url.searchParams.get('category');
        const status = url.searchParams.get('status');

        let query = 'SELECT * FROM products';
        const params = [];
        const conditions = [];

        if (category) {
          conditions.push('category = ?');
          params.push(category.toUpperCase());
        }

        if (status) {
          conditions.push('status = ?');
          params.push(status.toUpperCase());
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY id ASC';

        const { results } = await env.DB.prepare(query).bind(...params).all();

        const formatted = results.map(row => ({
          ...row,
          images: typeof row.images === 'string' ? JSON.parse(row.images) : row.images,
          sizes: typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes
        }));

        return jsonResponse({
          success: true,
          count: formatted.length,
          products: formatted
        });
      } catch (err) {
        return jsonResponse({ error: 'Failed to fetch products: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/create-order
    // Double purchase protection & Razorpay order creation via D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/create-order') {
      try {
        const data = await request.json();
        const items = data.items || [];
        const customer = data.customer || {};

        if (!Array.isArray(items) || items.length === 0) {
          return jsonResponse({ error: 'Invalid or empty items list' }, 400);
        }

        // Check availability in Cloudflare D1
        if (env.DB) {
          for (const item of items) {
            const product = await env.DB.prepare('SELECT id, product_name, status, numeric_price FROM products WHERE id = ?')
              .bind(item.id)
              .first();

            if (!product) {
              return jsonResponse({ error: `Product ${item.id} not found in catalog` }, 400);
            }

            if (product.status !== 'AVAILABLE') {
              return jsonResponse({
                error: 'Sorry, this item has just sold out.',
                sold_out_product_id: item.id,
                sold_out_product_name: product.product_name
              }, 400);
            }
          }
        }

        // Calculate subtotal amount securely
        let calculatedSubtotalRupees = 0;
        for (const item of items) {
          let price = 0;
          if (env.DB) {
            const product = await env.DB.prepare('SELECT numeric_price FROM products WHERE id = ?')
              .bind(item.id)
              .first();
            if (product && typeof product.numeric_price === 'number') {
              price = product.numeric_price;
            }
          }
          if (!price && typeof item.price === 'number' && item.price > 0) {
            price = item.price;
          } else if (!price && typeof item.price === 'string') {
            const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ''));
            if (!isNaN(parsed) && parsed > 0) price = parsed;
          }

          if (price <= 0) {
            return jsonResponse({ error: 'Invalid price for item: ' + (item.id || 'Unknown') }, 400);
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
            return jsonResponse({ error: 'Minimum order subtotal for Cash on Delivery is ₹200' }, 400);
          }
          chargeRupees = 200; // ₹200 mandatory advance
          advanceAmountRupees = 200;
          remainingAmountRupees = calculatedTotalRupees - 200;
        }

        const amountInPaise = chargeRupees * 100;
        const key_id = env.RAZORPAY_KEY_ID;
        const key_secret = env.RAZORPAY_KEY_SECRET;

        if (!key_id || !key_secret) {
          return jsonResponse({ error: 'Razorpay credentials not configured in Cloudflare environment.' }, 500);
        }

        const receiptId = 'rcpt_' + Date.now().toString().slice(-8) + '_' + Math.floor(Math.random() * 1000);

        // Call Razorpay API directly from Worker
        const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(key_id + ':' + key_secret)
          },
          body: JSON.stringify({
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
          })
        });

        const rzpOrder = await rzpResponse.json();

        if (!rzpResponse.ok) {
          return jsonResponse({ error: rzpOrder.error?.description || 'Razorpay order creation failed' }, rzpResponse.status);
        }

        return jsonResponse({
          order_id: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency || 'INR',
          key_id: key_id,
          receipt: rzpOrder.receipt,
          payment_method: paymentMethod,
          subtotal_amount: calculatedSubtotalRupees,
          shipping_charge: shippingChargeRupees,
          total_amount: calculatedTotalRupees,
          advance_amount: advanceAmountRupees,
          remaining_amount: remainingAmountRupees
        });
      } catch (err) {
        return jsonResponse({ error: 'Server error: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/verify-payment
    // Razorpay Signature Verification + Atomic D1 Order & Sold Out Update
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/verify-payment') {
      try {
        const data = await request.json();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
          return jsonResponse({ success: false, error: 'Missing payment signature parameters' }, 400);
        }

        const key_secret = env.RAZORPAY_KEY_SECRET;
        if (!key_secret) {
          return jsonResponse({ success: false, error: 'Razorpay secret key not configured' }, 500);
        }

        const isSignatureValid = await verifyRazorpaySignature(
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          key_secret
        );

        if (!isSignatureValid) {
          return jsonResponse({ success: false, error: 'Invalid payment signature. Verification failed.' }, 400);
        }

        const items = data.items || [];
        const customer = data.customer || {};
        const paymentMethod = data.payment_method === 'cod' ? 'COD' : 'ONLINE';
        const paymentStatus = paymentMethod === 'COD' ? 'ADVANCE_PAID' : 'PAID';

        // Calculate subtotal & shipping securely on backend
        let subtotalAmount = 0;
        for (const item of items) {
          let price = 0;
          if (env.DB) {
            const product = await env.DB.prepare('SELECT numeric_price FROM products WHERE id = ?')
              .bind(item.id)
              .first();
            if (product && typeof product.numeric_price === 'number') {
              price = product.numeric_price;
            }
          }
          if (!price && typeof item.price === 'number' && item.price > 0) {
            price = item.price;
          } else if (!price && typeof item.price === 'string') {
            const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ''));
            if (!isNaN(parsed) && parsed > 0) price = parsed;
          }
          subtotalAmount += price;
        }

        const shippingCharge = paymentMethod === 'COD' ? 100 : 0;
        const totalAmount = subtotalAmount + shippingCharge;
        const advanceAmount = paymentMethod === 'COD' ? 200 : totalAmount;
        const remainingAmount = paymentMethod === 'COD' ? Math.max(0, totalAmount - 200) : 0;
        const now = new Date().toISOString();
        const orderId = 'ORD_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const orderNumber = 'ZF-' + Date.now().toString().slice(-6);

        if (env.DB) {
          // 1. Double check availability in D1 before committing
          for (const item of items) {
            const product = await env.DB.prepare('SELECT status FROM products WHERE id = ?')
              .bind(item.id)
              .first();
            if (product && product.status !== 'AVAILABLE') {
              return jsonResponse({
                success: false,
                error: 'Sorry, this item has just sold out.'
              }, 400);
            }
          }

          // 2. Prepare atomic batch statements
          const statements = [];

          // Mark products as SOLD_OUT
          for (const item of items) {
            statements.push(
              env.DB.prepare("UPDATE products SET status = 'SOLD_OUT', updated_at = ? WHERE id = ?")
                .bind(now, item.id)
            );
          }

          // Insert order into D1 orders table
          statements.push(
            env.DB.prepare(`
              INSERT INTO orders (
                id, order_number, customer_name, customer_phone, customer_email,
                shipping_address, city, state, pincode, products, shipping_charge, total_amount,
                payment_method, payment_status, order_status, razorpay_order_id,
                razorpay_payment_id, advance_amount, remaining_amount, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              orderId,
              orderNumber,
              customer.name || 'Customer',
              customer.phone || '',
              customer.email || '',
              customer.address || '',
              customer.city || '',
              customer.state || '',
              customer.pincode || '',
              JSON.stringify(items),
              shippingCharge,
              totalAmount,
              paymentMethod,
              paymentStatus,
              'CONFIRMED',
              razorpay_order_id,
              razorpay_payment_id,
              advanceAmount,
              remainingAmount,
              now,
              now
            )
          );

          // Execute batch transaction in D1
          await env.DB.batch(statements);
        }

        return jsonResponse({
          success: true,
          message: 'Payment verified and order confirmed in D1 database',
          order_id: orderId,
          order_number: orderNumber,
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
        return jsonResponse({ success: false, error: 'Verification error: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // STATIC ASSETS FALLBACK (Pages / Workers Static Assets)
    // =========================================================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('404 Not Found', { status: 404 });
  }
};
