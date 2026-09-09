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

export async function onRequestPost({ request, env }) {
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
            available: false
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
      valid: soldItems.length === 0,
      items: validatedItems,
      sold_items: soldItems
    });
  } catch (err) {
    return jsonResponse({ error: 'Failed to validate cart: ' + err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
