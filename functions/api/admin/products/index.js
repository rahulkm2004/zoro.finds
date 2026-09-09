// Cloudflare Pages Function: /api/admin/products

function verifyAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const adminKey = request.headers.get('x-admin-key') || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  const expectedKey = env.ADMIN_API_KEY || env.ADMIN_SECRET || 'zoro-admin-secret-2026';
  return !!(adminKey && adminKey === expectedKey);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!verifyAdminAuth(request, env)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Invalid admin key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
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

    return new Response(JSON.stringify({
      success: true,
      count: formatted.length,
      products: formatted
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!verifyAdminAuth(request, env)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Invalid admin key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const data = await request.json();
    const id = (data.id || data.product_id || '').trim();
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Product ID is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Check duplicate Product ID
    const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Product ID already exists.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const category = (data.category || 'JACKETS').toUpperCase();
    if (category !== 'JACKETS' && category !== 'HOODIES') {
      return new Response(JSON.stringify({ success: false, error: 'Category must be either JACKETS or HOODIES.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
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
    return new Response(JSON.stringify({
      success: true,
      message: 'Product added successfully',
      product: {
        ...createdProduct,
        images: typeof createdProduct.images === 'string' ? JSON.parse(createdProduct.images) : createdProduct.images,
        sizes: typeof createdProduct.sizes === 'string' ? JSON.parse(createdProduct.sizes) : createdProduct.sizes
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!verifyAdminAuth(request, env)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Invalid admin key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const data = await request.json();
    const id = data.id;
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Product ID is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ success: true, message: 'Product deleted successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
