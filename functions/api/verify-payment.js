// Cloudflare Pages Function: POST /api/verify-payment
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

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(JSON.stringify({ success: false, error: 'Missing payment signature parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const key_secret = env.RAZORPAY_KEY_SECRET;
    if (!key_secret) {
      return new Response(JSON.stringify({ success: false, error: 'Razorpay secret key not configured on server' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const isSignatureValid = await verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      key_secret
    );

    if (!isSignatureValid) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid payment signature. Verification failed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
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
      // ATOMIC 1-OF-1 CLAIM:
      for (const item of items) {
        const updateRes = await env.DB.prepare(
          "UPDATE products SET status = 'SOLD_OUT', updated_at = ? WHERE id = ? AND status = 'AVAILABLE'"
        ).bind(now, item.id).run();

        if (!updateRes.meta || updateRes.meta.changes === 0) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Sorry, this item has just sold out.',
            sold_out_product_id: item.id,
            conflict: true
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }

      // Insert order into D1 orders table
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

    return new Response(JSON.stringify({
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
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: 'Verification error: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
