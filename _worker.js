/**
 * Cloudflare Worker Handler for ZORO.FINDS
 * Integrates Cloudflare D1 Database (binding: env.DB)
 * Permanent database for Products, 1-of-1 Availability, 10-Minute Temporary Reservations, Orders, and Razorpay Payments.
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

// Helper: Purge expired active reservations in D1
async function purgeExpiredReservations(db) {
  if (!db) return;
  const now = new Date().toISOString();
  try {
    await db.prepare("UPDATE product_reservations SET status = 'EXPIRED', updated_at = ? WHERE status = 'ACTIVE' AND expires_at <= ?")
      .bind(now, now)
      .run();
  } catch (e) {
    // Graceful fallback if table is initializing
  }
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
    // API ROUTE: GET /api/orders
    // Fetches confirmed orders from D1 database
    // =========================================================================
    if (request.method === 'GET' && pathname === '/api/orders') {
      if (!env.DB) {
        return jsonResponse({ error: 'Cloudflare D1 Database binding is not configured.' }, 500);
      }
      try {
        const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
        const formatted = results.map(row => ({
          ...row,
          products: typeof row.products === 'string' ? JSON.parse(row.products) : row.products
        }));
        return jsonResponse({
          success: true,
          count: formatted.length,
          orders: formatted
        });
      } catch (err) {
        return jsonResponse({ error: 'Failed to fetch orders: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/reserve
    // Creates a 10-minute temporary server-side checkout reservation in D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/reserve') {
      try {
        const data = await request.json();
        const items = data.items || [];
        const sessionId = data.session_id || data.sessionId;

        if (!sessionId) {
          return jsonResponse({ error: 'Session ID is required for checkout reservation' }, 400);
        }

        const itemIds = items.map(i => (typeof i === 'string' ? i : i.id)).filter(Boolean);
        if (itemIds.length === 0) {
          return jsonResponse({ success: true, expires_at: null });
        }

        if (env.DB) {
          await purgeExpiredReservations(env.DB);
          const now = new Date().toISOString();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

          // 1. Check availability and competing reservations
          for (const pid of itemIds) {
            const product = await env.DB.prepare('SELECT id, product_name, status FROM products WHERE id = ?')
              .bind(pid)
              .first();

            if (!product || product.status !== 'AVAILABLE') {
              return jsonResponse({
                success: false,
                reason: 'SOLD_OUT',
                product_id: pid,
                product_name: product?.product_name || pid,
                error: 'Sorry, this item has just sold out.'
              }, 400);
            }

            const competing = await env.DB.prepare(
              "SELECT id, session_id, expires_at FROM product_reservations WHERE product_id = ? AND status = 'ACTIVE' AND expires_at > ? AND session_id != ?"
            ).bind(pid, now, sessionId).first();

            if (competing) {
              return jsonResponse({
                success: false,
                reason: 'RESERVED',
                product_id: pid,
                product_name: product.product_name,
                error: 'Sorry, this item is currently being purchased by another customer.'
              }, 400);
            }
          }

          // 2. Insert or refresh reservations
          for (const pid of itemIds) {
            await env.DB.prepare(
              "UPDATE product_reservations SET status = 'EXPIRED', updated_at = ? WHERE product_id = ? AND session_id = ? AND status = 'ACTIVE'"
            ).bind(now, pid, sessionId).run();

            const resId = 'RES_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            await env.DB.prepare(`
              INSERT INTO product_reservations (
                id, product_id, session_id, reserved_at, expires_at, status, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
            `).bind(resId, pid, sessionId, now, expiresAt, now, now).run();
          }

          return jsonResponse({
            success: true,
            expires_at: expiresAt,
            session_id: sessionId,
            product_ids: itemIds
          });
        }

        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: 'Reservation error: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/release-reservation
    // Releases active reservation when customer abandons checkout
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/release-reservation') {
      try {
        const data = await request.json();
        const sessionId = data.session_id || data.sessionId;
        const items = data.items || [];
        const itemIds = items.map(i => (typeof i === 'string' ? i : i.id)).filter(Boolean);

        if (env.DB && sessionId) {
          const now = new Date().toISOString();
          if (itemIds.length > 0) {
            for (const pid of itemIds) {
              await env.DB.prepare(
                "UPDATE product_reservations SET status = 'CANCELLED', updated_at = ? WHERE session_id = ? AND product_id = ? AND status = 'ACTIVE'"
              ).bind(now, sessionId, pid).run();
            }
          } else {
            await env.DB.prepare(
              "UPDATE product_reservations SET status = 'CANCELLED', updated_at = ? WHERE session_id = ? AND status = 'ACTIVE'"
            ).bind(now, sessionId).run();
          }
        }

        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: 'Release error: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/validate-cart
    // Validates real-time product availability and active 10-min reservations in D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/validate-cart') {
      try {
        const data = await request.json();
        const items = data.items || [];
        const sessionId = data.session_id || data.sessionId || null;
        const validatedItems = [];
        const soldItems = [];
        const reservedItems = [];

        if (env.DB) {
          await purgeExpiredReservations(env.DB);
          const now = new Date().toISOString();

          for (const item of items) {
            const itemId = typeof item === 'string' ? item : item.id;
            const product = await env.DB.prepare('SELECT id, product_name, status, numeric_price, price FROM products WHERE id = ?')
              .bind(itemId)
              .first();

            if (!product || product.status !== 'AVAILABLE') {
              soldItems.push(itemId);
              validatedItems.push({
                id: itemId,
                name: product?.product_name || item.name || itemId,
                status: product?.status || 'SOLD_OUT',
                numeric_price: product?.numeric_price || item.numericPrice || 0,
                available: false,
                reason: 'SOLD_OUT',
                message: 'Sorry, this item has just sold out.'
              });
              continue;
            }

            // Check if actively reserved by another customer
            let resQuery = "SELECT id, session_id, expires_at FROM product_reservations WHERE product_id = ? AND status = 'ACTIVE' AND expires_at > ?";
            const resParams = [itemId, now];
            if (sessionId) {
              resQuery += " AND session_id != ?";
              resParams.push(sessionId);
            }

            const competingRes = await env.DB.prepare(resQuery).bind(...resParams).first();

            if (competingRes) {
              reservedItems.push(itemId);
              validatedItems.push({
                id: itemId,
                name: product.product_name,
                status: 'RESERVED',
                numeric_price: product.numeric_price,
                available: false,
                reason: 'RESERVED',
                message: 'Sorry, this item is currently being purchased by another customer.'
              });
            } else {
              validatedItems.push({
                id: itemId,
                name: product.product_name,
                status: 'AVAILABLE',
                numeric_price: product.numeric_price,
                price: product.price,
                available: true
              });
            }
          }
        }

        return jsonResponse({
          valid: (soldItems.length === 0 && reservedItems.length === 0),
          items: validatedItems,
          sold_items: soldItems,
          reserved_items: reservedItems
        });
      } catch (err) {
        return jsonResponse({ error: 'Failed to validate cart: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/create-order
    // Availability verification, 10-minute hold, & Razorpay order creation via D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/create-order') {
      try {
        const data = await request.json();
        const items = data.items || [];
        const customer = data.customer || {};
        const sessionId = data.session_id || data.sessionId;

        if (!Array.isArray(items) || items.length === 0) {
          return jsonResponse({ error: 'Invalid or empty items list' }, 400);
        }

        const itemIds = items.map(i => (typeof i === 'string' ? i : i.id)).filter(Boolean);

        // Check availability and reservation in Cloudflare D1
        if (env.DB) {
          await purgeExpiredReservations(env.DB);
          const now = new Date().toISOString();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

          for (const item of items) {
            const product = await env.DB.prepare('SELECT id, product_name, status, numeric_price FROM products WHERE id = ?')
              .bind(item.id)
              .first();

            if (!product || product.status !== 'AVAILABLE') {
              return jsonResponse({
                error: 'Sorry, this item has just sold out.',
                sold_items: [item.id],
                sold_out_product_id: item.id,
                sold_out_product_name: product?.product_name || item.id
              }, 400);
            }

            if (sessionId) {
              const competing = await env.DB.prepare(
                "SELECT id, session_id, expires_at FROM product_reservations WHERE product_id = ? AND status = 'ACTIVE' AND expires_at > ? AND session_id != ?"
              ).bind(item.id, now, sessionId).first();

              if (competing) {
                return jsonResponse({
                  error: 'Sorry, this item is currently being purchased by another customer.',
                  reserved_items: [item.id],
                  reserved: true
                }, 400);
              }

              // Lock/refresh 10-minute hold for this session
              await env.DB.prepare(
                "UPDATE product_reservations SET status = 'EXPIRED', updated_at = ? WHERE product_id = ? AND session_id = ? AND status = 'ACTIVE'"
              ).bind(now, item.id, sessionId).run();

              const resId = 'RES_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
              await env.DB.prepare(`
                INSERT INTO product_reservations (
                  id, product_id, session_id, reserved_at, expires_at, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
              `).bind(resId, item.id, sessionId, now, expiresAt, now, now).run();
            }
          }
        }

        // Calculate subtotal amount securely from database
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
    // Razorpay Signature Verification + ATOMIC D1 1-of-1 Claim & Completed Reservation
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
        const sessionId = data.session_id || data.sessionId || null;
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
          // 1. Idempotency Check: if razorpay_payment_id has already been processed, return existing order
          const existingOrder = await env.DB.prepare(
            "SELECT * FROM orders WHERE razorpay_payment_id = ?"
          ).bind(razorpay_payment_id).first();

          if (existingOrder) {
            return jsonResponse({
              success: true,
              idempotent: true,
              message: 'Order already confirmed',
              order_id: existingOrder.id,
              order_number: existingOrder.order_number,
              payment_id: existingOrder.razorpay_payment_id,
              payment_method: existingOrder.payment_method,
              payment_status: existingOrder.payment_status,
              subtotal_amount: subtotalAmount,
              shipping_charge: existingOrder.shipping_charge,
              total_amount: existingOrder.total_amount,
              advance_amount: existingOrder.advance_amount,
              remaining_amount: existingOrder.remaining_amount
            });
          }

          // 2. ATOMIC 1-OF-1 CLAIM PROTECTION:
          for (const item of items) {
            const updateRes = await env.DB.prepare(
              "UPDATE products SET status = 'SOLD_OUT', updated_at = ? WHERE id = ? AND status = 'AVAILABLE'"
            ).bind(now, item.id).run();

            if (!updateRes.meta || updateRes.meta.changes === 0) {
              // EDGE CASE: Payment succeeded on Razorpay, but product was claimed by another customer
              return jsonResponse({
                success: false,
                conflict: true,
                error: 'Sorry, this item was just claimed by another customer. Your payment has been received and will be automatically refunded.',
                sold_out_product_id: item.id
              }, 400);
            }

            // Convert active reservation to COMPLETED
            if (sessionId) {
              await env.DB.prepare(
                "UPDATE product_reservations SET status = 'COMPLETED', updated_at = ? WHERE product_id = ? AND session_id = ? AND status = 'ACTIVE'"
              ).bind(now, item.id, sessionId).run();
            } else {
              await env.DB.prepare(
                "UPDATE product_reservations SET status = 'COMPLETED', updated_at = ? WHERE product_id = ? AND status = 'ACTIVE'"
              ).bind(now, item.id).run();
            }
          }

          // 3. Insert order into D1 orders table
          await env.DB.prepare(`
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
          ).run();
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
