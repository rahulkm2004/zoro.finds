// Pages Function: POST /api/reserve
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
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
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Expire old
      await env.DB.prepare("UPDATE product_reservations SET status = 'EXPIRED', updated_at = ? WHERE status = 'ACTIVE' AND expires_at <= ?")
        .bind(now, now)
        .run();

      // Check availability & competing
      for (const pid of itemIds) {
        const product = await env.DB.prepare('SELECT id, product_name, status FROM products WHERE id = ?').bind(pid).first();
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

      // Insert/update
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
