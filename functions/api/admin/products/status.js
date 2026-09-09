// Cloudflare Pages Function: POST /api/admin/products/status

function verifyAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const adminKey = request.headers.get('x-admin-key') || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  const expectedKey = env.ADMIN_API_KEY || env.ADMIN_SECRET || 'zoro-admin-secret-2026';
  return !!(adminKey && adminKey === expectedKey);
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
    const { id, status, sale_source } = data;
    if (!id || !status) {
      return new Response(JSON.stringify({ success: false, error: 'Missing product id or status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    if (!product) {
      return new Response(JSON.stringify({ success: false, error: 'Product not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
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
    return new Response(JSON.stringify({
      success: true,
      message: `Product status updated to ${targetStatus}`,
      product: {
        ...updated,
        images: typeof updated.images === 'string' ? JSON.parse(updated.images) : updated.images,
        sizes: typeof updated.sizes === 'string' ? JSON.parse(updated.sizes) : updated.sizes
      }
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

export const onRequestPatch = onRequestPost;
