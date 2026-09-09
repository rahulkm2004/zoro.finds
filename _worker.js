/**
 * Cloudflare Worker Handler for ZORO.FINDS
 * Integrates Cloudflare D1 Database (binding: env.DB)
 * Permanent database for Products, 1-of-1 Availability, 10-Minute Temporary Reservations, Orders, and Razorpay Payments.
 */

import { sendAdminOrderNotification, sendCustomerOrderConfirmation } from './email-service.js';

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

// Helper: Verify Admin Authorization Header
function verifyAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const adminKey = request.headers.get('x-admin-key') || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  const expectedKey = env.ADMIN_API_KEY || env.ADMIN_SECRET || 'zoro-admin-secret-2026';
  return !!(adminKey && adminKey === expectedKey);
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
    // API ROUTE: POST /api/test-mailjet
    // Safe admin test to verify Mailjet configuration and connectivity
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/test-mailjet') {
      const apiKey = env.MAILJET_API_KEY;
      const apiSecret = env.MAILJET_API_SECRET;
      const senderEmail = env.MAILJET_SENDER_EMAIL;
      const senderName = env.MAILJET_SENDER_NAME || 'ZORO.FINDS';
      const adminEmail = env.ADMIN_ORDER_EMAIL;

      const detected = {
        MAILJET_API_KEY: !!apiKey,
        MAILJET_API_SECRET: !!apiSecret,
        MAILJET_SENDER_EMAIL: !!senderEmail,
        MAILJET_SENDER_NAME: !!senderName,
        ADMIN_ORDER_EMAIL: !!adminEmail
      };

      const allConfigured = apiKey && apiSecret && senderEmail && adminEmail;

      if (!allConfigured) {
        return jsonResponse({
          configuration_detected: false,
          variables_detected: detected,
          email_api_successful: false,
          email_delivered: false,
          error: 'Missing one or more required Mailjet environment variables in Cloudflare runtime.'
        }, 400);
      }

      const authHeader = 'Basic ' + btoa(`${apiKey}:${apiSecret}`);
      const payload = {
        Messages: [
          {
            From: {
              Email: senderEmail.trim(),
              Name: senderName.trim()
            },
            To: [
              {
                Email: adminEmail.trim(),
                Name: 'ZORO.FINDS Admin'
              }
            ],
            Subject: 'ZORO.FINDS — Mailjet Test',
            HTMLPart: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e5e5; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
                <div style="background: #080808; padding: 22px; text-align: center; border-bottom: 3px solid #c89d55;">
                  <h1 style="color: #ffffff; font-family: 'Georgia', serif; font-size: 22px; letter-spacing: 0.22em; margin: 0; text-transform: uppercase;">ZORO.FINDS</h1>
                  <p style="color: #c89d55; font-family: 'Courier New', Courier, monospace; font-size: 11px; margin: 6px 0 0 0; letter-spacing: 0.12em; text-transform: uppercase;">ADMIN NOTIFICATION SYSTEM TEST</p>
                </div>
                <div style="padding: 26px;">
                  <h2 style="font-size: 16px; color: #111111; margin-top: 0; font-family: 'Courier New', Courier, monospace; font-weight: bold; letter-spacing: 0.05em;">ZORO.FINDS</h2>
                  <p style="color: #111111; font-size: 15px; font-weight: 600; line-height: 1.6; margin: 12px 0;">Mailjet admin notification is working successfully.</p>
                  <p style="color: #666666; font-size: 13px; line-height: 1.5; margin: 8px 0;">This is a test email only.</p>
                  <div style="background: #f4f4f5; border-left: 3px solid #15803d; padding: 14px 16px; border-radius: 2px; font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #27272a; margin-top: 20px;">
                    <div style="color: #15803d; font-weight: bold; margin-bottom: 6px;">✓ SYSTEM VERIFICATION SUCCESSFUL</div>
                    <div>• Cloudflare Worker: Connected</div>
                    <div>• Mailjet API v3.1: Active</div>
                    <div>• Timestamp: ${new Date().toISOString()}</div>
                  </div>
                </div>
                <div style="background: #fafafa; padding: 14px 20px; text-align: center; border-top: 1px solid #e5e5e5; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #71717a;">
                  ZORO.FINDS STORE ENGINE · CONFIDENTIAL ADMIN TEST
                </div>
              </div>
            `,
            TextPart: `ZORO.FINDS\n\nMailjet admin notification is working successfully.\n\nThis is a test email only.`
          }
        ]
      };

      try {
        const response = await fetch('https://api.mailjet.com/v3.1/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
          return jsonResponse({
            configuration_detected: true,
            email_api_successful: false,
            email_delivered: false,
            api_status: response.status,
            error: result.ErrorMessage || result.message || 'Mailjet API responded with an error.'
          }, response.status);
        }

        const msgStatus = result.Messages?.[0]?.Status;
        const isSuccess = msgStatus === 'success';

        return jsonResponse({
          configuration_detected: true,
          variables_detected: detected,
          email_api_successful: true,
          email_delivered: isSuccess,
          message_status: msgStatus,
          message_id: result.Messages?.[0]?.To?.[0]?.MessageID || null
        });
      } catch (err) {
        return jsonResponse({
          configuration_detected: true,
          email_api_successful: false,
          email_delivered: false,
          error: err.message
        }, 500);
      }
    }

    // =========================================================================
    // ADMIN API ROUTE: POST /api/admin/auth/verify
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/admin/auth/verify') {
      if (!verifyAdminAuth(request, env)) {
        return jsonResponse({ success: false, error: 'Unauthorized: Invalid admin key' }, 401);
      }
      return jsonResponse({ success: true, message: 'Admin authenticated successfully' });
    }

    // =========================================================================
    // ADMIN API ROUTE: GET /api/admin/products
    // Returns full inventory with status, sale_source, sold_at, and linked orders
    // =========================================================================
    if (request.method === 'GET' && pathname === '/api/admin/products') {
      if (!verifyAdminAuth(request, env)) {
        return jsonResponse({ success: false, error: 'Unauthorized: Invalid admin key' }, 401);
      }
      if (!env.DB) {
        return jsonResponse({ success: false, error: 'D1 binding not found' }, 500);
      }
      try {
        const { results } = await env.DB.prepare(`
          SELECT p.*, o.id as linked_order_id, o.order_number as linked_order_number, o.customer_name as linked_customer_name
          FROM products p
          LEFT JOIN orders o ON o.products LIKE '%' || p.id || '%'
          ORDER BY p.created_at DESC, p.id DESC
        `).all();

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
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // =========================================================================
    // ADMIN API ROUTE: POST /api/admin/products
    // Manually add a new Jacket or Hoodie to D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/admin/products') {
      if (!verifyAdminAuth(request, env)) {
        return jsonResponse({ success: false, error: 'Unauthorized: Invalid admin key' }, 401);
      }
      if (!env.DB) {
        return jsonResponse({ success: false, error: 'D1 binding not found' }, 500);
      }
      try {
        const data = await request.json();
        const id = (data.id || data.product_id || '').trim();
        if (!id) {
          return jsonResponse({ success: false, error: 'Product ID is required.' }, 400);
        }

        // Duplicate Check
        const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
        if (existing) {
          return jsonResponse({ success: false, error: 'Product ID already exists.' }, 409);
        }

        const category = (data.category || 'JACKETS').toUpperCase();
        if (category !== 'JACKETS' && category !== 'HOODIES') {
          return jsonResponse({ success: false, error: 'Category must be either JACKETS or HOODIES.' }, 400);
        }

        let numericPrice = typeof data.numeric_price === 'number' ? data.numeric_price : parseFloat(data.price?.replace(/[^0-9.]/g, '')) || 0;
        let formattedPrice = data.price ? data.price : ('₹' + numericPrice.toLocaleString('en-IN'));

        const now = new Date().toISOString();
        const images = Array.isArray(data.images) ? JSON.stringify(data.images) : (typeof data.images === 'string' ? data.images : '[]');
        const sizes = Array.isArray(data.sizes) ? JSON.stringify(data.sizes) : (typeof data.sizes === 'string' ? data.sizes : JSON.stringify([data.display_size || 'Free Size']));

        await env.DB.prepare(`
          INSERT INTO products (
            id, product_name, category, price, numeric_price, description,
            images, sizes, display_size, chest, length, condition,
            status, sale_source, sold_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
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
        ).run();

        const createdProduct = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
        return jsonResponse({
          success: true,
          message: 'Product added successfully',
          product: {
            ...createdProduct,
            images: typeof createdProduct.images === 'string' ? JSON.parse(createdProduct.images) : createdProduct.images,
            sizes: typeof createdProduct.sizes === 'string' ? JSON.parse(createdProduct.sizes) : createdProduct.sizes
          }
        }, 201);
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // =========================================================================
    // ADMIN API ROUTE: POST /api/admin/products/status or PATCH
    // Update product status (e.g. mark SOLD_OUT with INSTAGRAM_DM or restore AVAILABLE)
    // =========================================================================
    if ((request.method === 'POST' || request.method === 'PATCH') && pathname === '/api/admin/products/status') {
      if (!verifyAdminAuth(request, env)) {
        return jsonResponse({ success: false, error: 'Unauthorized: Invalid admin key' }, 401);
      }
      if (!env.DB) {
        return jsonResponse({ success: false, error: 'D1 binding not found' }, 500);
      }
      try {
        const data = await request.json();
        const { id, status, sale_source } = data;
        if (!id || !status) {
          return jsonResponse({ success: false, error: 'Missing product id or status' }, 400);
        }

        const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
        if (!product) {
          return jsonResponse({ success: false, error: 'Product not found' }, 404);
        }

        const targetStatus = status.toUpperCase();
        const now = new Date().toISOString();

        let finalSaleSource = null;
        let finalSoldAt = null;

        if (targetStatus === 'SOLD_OUT') {
          finalSaleSource = sale_source || product.sale_source || 'MANUAL';
          finalSoldAt = product.sold_at || now;
        } else if (targetStatus === 'AVAILABLE') {
          finalSaleSource = null;
          finalSoldAt = null;
        } else if (targetStatus === 'ARCHIVED') {
          finalSaleSource = product.sale_source;
          finalSoldAt = product.sold_at;
        }

        try {
          await env.DB.prepare(`
            UPDATE products 
            SET status = ?, sale_source = ?, sold_at = ?, updated_at = ? 
            WHERE id = ?
          `).bind(targetStatus, finalSaleSource, finalSoldAt, now, id).run();
        } catch (dbErr) {
          // If columns missing in older schema, add dynamically
          try {
            await env.DB.prepare("ALTER TABLE products ADD COLUMN sale_source TEXT DEFAULT NULL").run();
            await env.DB.prepare("ALTER TABLE products ADD COLUMN sold_at TEXT DEFAULT NULL").run();
            await env.DB.prepare(`
              UPDATE products 
              SET status = ?, sale_source = ?, sold_at = ?, updated_at = ? 
              WHERE id = ?
            `).bind(targetStatus, finalSaleSource, finalSoldAt, now, id).run();
          } catch (alterErr) {
            await env.DB.prepare("UPDATE products SET status = ?, updated_at = ? WHERE id = ?").bind(targetStatus, now, id).run();
          }
        }

        const updated = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
        return jsonResponse({
          success: true,
          message: `Product status updated to ${targetStatus}`,
          product: {
            ...updated,
            images: typeof updated.images === 'string' ? JSON.parse(updated.images) : updated.images,
            sizes: typeof updated.sizes === 'string' ? JSON.parse(updated.sizes) : updated.sizes
          }
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // =========================================================================
    // ADMIN API ROUTE: DELETE /api/admin/products
    // =========================================================================
    if (request.method === 'DELETE' && (pathname === '/api/admin/products' || pathname.startsWith('/api/admin/products/'))) {
      if (!verifyAdminAuth(request, env)) {
        return jsonResponse({ success: false, error: 'Unauthorized: Invalid admin key' }, 401);
      }
      if (!env.DB) {
        return jsonResponse({ success: false, error: 'D1 binding not found' }, 500);
      }
      try {
        let id = '';
        if (pathname.startsWith('/api/admin/products/')) {
          id = pathname.replace('/api/admin/products/', '');
        } else {
          const body = await request.json();
          id = body.id;
        }
        await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true, message: 'Product deleted successfully' });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
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

        query += ' ORDER BY created_at DESC, id DESC';

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
    // Compatibility route: No inventory blocking prior to payment
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/reserve') {
      return jsonResponse({ success: true, expires_at: null });
    }

    // =========================================================================
    // API ROUTE: POST /api/release-reservation
    // Compatibility route
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/release-reservation') {
      return jsonResponse({ success: true });
    }

    // =========================================================================
    // API ROUTE: POST /api/validate-cart
    // Validates real-time product availability (AVAILABLE vs SOLD_OUT) in D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/validate-cart') {
      try {
        const data = await request.json();
        const items = data.items || [];
        const validatedItems = [];
        const soldItems = [];

        if (env.DB) {
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
          valid: (soldItems.length === 0),
          items: validatedItems,
          sold_items: soldItems,
          reserved_items: []
        });
      } catch (err) {
        return jsonResponse({ error: 'Failed to validate cart: ' + err.message }, 500);
      }
    }

    // =========================================================================
    // API ROUTE: POST /api/create-order
    // Availability verification & Razorpay order creation via D1
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/create-order') {
      try {
        const data = await request.json();
        const items = data.items || [];
        const customer = data.customer || {};
        const sessionId = data.session_id || '';

        if (!Array.isArray(items) || items.length === 0) {
          return jsonResponse({ error: 'Invalid or empty items list' }, 400);
        }

        // Check availability in Cloudflare D1
        if (env.DB) {
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
            // DUPLICATE EMAIL PROTECTION:
            // 1. Admin packing email retry if not yet sent
            if (!existingOrder.admin_email_sent) {
              try {
                const parsedProducts = typeof existingOrder.products === 'string' ? JSON.parse(existingOrder.products) : existingOrder.products;
                const emailRes = await sendAdminOrderNotification({
                  ...existingOrder,
                  products: parsedProducts,
                  subtotal_amount: subtotalAmount
                }, env);
                if (emailRes && emailRes.success) {
                  try {
                    await env.DB.prepare("UPDATE orders SET admin_email_sent = 1, admin_email_sent_at = ? WHERE id = ?")
                      .bind(now, existingOrder.id).run();
                  } catch (e) {}
                }
              } catch (e) {
                console.warn('[Mailjet] Retry admin notification failed:', e.message);
              }
            }

            // 2. Customer confirmation email retry if not yet sent
            if (!existingOrder.customer_email_sent && (existingOrder.customer_email || customer.email)) {
              try {
                const parsedProducts = typeof existingOrder.products === 'string' ? JSON.parse(existingOrder.products) : existingOrder.products;
                const custRes = await sendCustomerOrderConfirmation({
                  ...existingOrder,
                  customer_email: existingOrder.customer_email || customer.email,
                  customer_name: existingOrder.customer_name || customer.name,
                  products: parsedProducts,
                  subtotal_amount: subtotalAmount
                }, env);
                if (custRes && custRes.success) {
                  try {
                    await env.DB.prepare("UPDATE orders SET customer_email_sent = 1, customer_email_sent_at = ? WHERE id = ?")
                      .bind(now, existingOrder.id).run();
                  } catch (e) {}
                }
              } catch (e) {
                console.warn('[Mailjet] Retry customer confirmation failed:', e.message);
              }
            }

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
            let updateRes;
            try {
              updateRes = await env.DB.prepare(
                "UPDATE products SET status = 'SOLD_OUT', sale_source = 'WEBSITE', sold_at = ?, updated_at = ? WHERE id = ? AND status = 'AVAILABLE'"
              ).bind(now, now, item.id).run();
            } catch (claimErr) {
              try {
                await env.DB.prepare("ALTER TABLE products ADD COLUMN sale_source TEXT DEFAULT NULL").run();
                await env.DB.prepare("ALTER TABLE products ADD COLUMN sold_at TEXT DEFAULT NULL").run();
                updateRes = await env.DB.prepare(
                  "UPDATE products SET status = 'SOLD_OUT', sale_source = 'WEBSITE', sold_at = ?, updated_at = ? WHERE id = ? AND status = 'AVAILABLE'"
                ).bind(now, now, item.id).run();
              } catch (alterErr) {
                updateRes = await env.DB.prepare(
                  "UPDATE products SET status = 'SOLD_OUT', updated_at = ? WHERE id = ? AND status = 'AVAILABLE'"
                ).bind(now, item.id).run();
              }
            }

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
          try {
            await env.DB.prepare(`
              INSERT INTO orders (
                id, order_number, customer_name, customer_phone, customer_email,
                shipping_address, city, state, pincode, products, shipping_charge, total_amount,
                payment_method, payment_status, order_status, razorpay_order_id,
                razorpay_payment_id, advance_amount, remaining_amount, admin_email_sent, customer_email_sent, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
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
          } catch (insertErr) {
            // Fallback if email tracking columns not yet in older table
            try {
              await env.DB.prepare(`
                INSERT INTO orders (
                  id, order_number, customer_name, customer_phone, customer_email,
                  shipping_address, city, state, pincode, products, shipping_charge, total_amount,
                  payment_method, payment_status, order_status, razorpay_order_id,
                  razorpay_payment_id, advance_amount, remaining_amount, admin_email_sent, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
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
            } catch (fbErr) {
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
          }

          // 4. Send Admin Packing Notification Email via Mailjet (Independent & Protected)
          const orderPayload = {
            id: orderId,
            order_number: orderNumber,
            customer_name: customer.name || 'Customer',
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
            created_at: now
          };

          try {
            const emailResult = await sendAdminOrderNotification(orderPayload, env);
            if (emailResult && emailResult.success) {
              try {
                await env.DB.prepare("UPDATE orders SET admin_email_sent = 1, admin_email_sent_at = ? WHERE id = ?")
                  .bind(now, orderId).run();
              } catch (dbErr) {
                try {
                  await env.DB.prepare("ALTER TABLE orders ADD COLUMN admin_email_sent INTEGER DEFAULT 0").run();
                  await env.DB.prepare("ALTER TABLE orders ADD COLUMN admin_email_sent_at TEXT").run();
                  await env.DB.prepare("UPDATE orders SET admin_email_sent = 1, admin_email_sent_at = ? WHERE id = ?")
                    .bind(now, orderId).run();
                } catch (alterErr) {}
              }
            }
          } catch (emailErr) {
            console.error('[Admin Email Error]:', emailErr.message);
          }

          // 5. Send Customer Confirmation Email via Mailjet (Independent & Protected)
          if (customer.email && customer.email.includes('@')) {
            try {
              const custEmailResult = await sendCustomerOrderConfirmation(orderPayload, env);
              if (custEmailResult && custEmailResult.success) {
                try {
                  await env.DB.prepare("UPDATE orders SET customer_email_sent = 1, customer_email_sent_at = ? WHERE id = ?")
                    .bind(now, orderId).run();
                } catch (dbErr) {
                  try {
                    await env.DB.prepare("ALTER TABLE orders ADD COLUMN customer_email_sent INTEGER DEFAULT 0").run();
                    await env.DB.prepare("ALTER TABLE orders ADD COLUMN customer_email_sent_at TEXT").run();
                    await env.DB.prepare("UPDATE orders SET customer_email_sent = 1, customer_email_sent_at = ? WHERE id = ?")
                      .bind(now, orderId).run();
                  } catch (alterErr) {}
                }
              }
            } catch (custEmailErr) {
              console.error('[Customer Email Error]:', custEmailErr.message);
            }
          }
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
    if (pathname === '/admin') {
      const adminUrl = new URL('/admin.html', request.url);
      if (env.ASSETS) {
        return env.ASSETS.fetch(new Request(adminUrl, request));
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('404 Not Found', { status: 404 });
  }
};
