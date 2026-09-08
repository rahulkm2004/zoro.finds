// Cloudflare Pages Function: POST /api/create-order
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const items = data.items || [];
    const customer = data.customer || {};

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid or empty items list' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Check availability in Cloudflare D1
    if (env.DB) {
      for (const item of items) {
        const product = await env.DB.prepare('SELECT id, product_name, status, numeric_price FROM products WHERE id = ?')
          .bind(item.id)
          .first();

        if (!product) {
          return new Response(JSON.stringify({ error: `Product ${item.id} not found in catalog` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        if (product.status !== 'AVAILABLE') {
          return new Response(JSON.stringify({
            error: 'Sorry, this item has just sold out.',
            sold_out_product_id: item.id,
            sold_out_product_name: product.product_name
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }
    }

    // Calculate total amount securely
    let calculatedTotalRupees = 0;
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
        return new Response(JSON.stringify({ error: 'Invalid price for item: ' + (item.id || 'Unknown') }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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
        return new Response(JSON.stringify({ error: 'Minimum order subtotal for Cash on Delivery is ₹200' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      chargeRupees = 200; // ₹200 mandatory advance
      advanceAmountRupees = 200;
      remainingAmountRupees = calculatedTotalRupees - 200;
    }

    const amountInPaise = chargeRupees * 100;
    const key_id = env.RAZORPAY_KEY_ID;
    const key_secret = env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
      return new Response(JSON.stringify({ error: 'Razorpay credentials not configured in Cloudflare environment.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const receiptId = 'rcpt_' + Date.now().toString().slice(-8) + '_' + Math.floor(Math.random() * 1000);

    // Call Razorpay API directly from Pages Function
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
      return new Response(JSON.stringify({ error: rzpOrder.error?.description || 'Razorpay order creation failed' }), {
        status: rzpResponse.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({
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
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error: ' + err.message }), {
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
