// Pages Function: POST /api/release-reservation
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
