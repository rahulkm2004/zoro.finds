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
    const totalAmount = typeof data.total_amount === 'number' ? data.total_amount : 0;
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
          return new Response(JSON.stringify({
            success: false,
            error: 'Sorry, this item has just sold out.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
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
            shipping_address, city, state, pincode, products, total_amount,
            payment_method, payment_status, order_status, razorpay_order_id,
            razorpay_payment_id, advance_amount, remaining_amount, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    return new Response(JSON.stringify({
      success: true,
      message: 'Payment verified and order confirmed in D1 database',
      order_id: orderId,
      order_number: orderNumber,
      payment_id: razorpay_payment_id,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
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
