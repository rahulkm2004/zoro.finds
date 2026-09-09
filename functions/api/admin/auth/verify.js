// Cloudflare Pages Function: POST /api/admin/auth/verify

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

  return new Response(JSON.stringify({ success: true, message: 'Admin authenticated successfully' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
