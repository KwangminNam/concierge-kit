/** The fake backend's refresh endpoint. Answers only when the refresh token reached it. */
export async function POST(request: Request): Promise<Response> {
  const cookie = request.headers.get('cookie') ?? '';
  if (!cookie.includes('refresh_token=valid')) {
    return new Response(JSON.stringify({ error: 'INVALID_REFRESH' }), { status: 401 });
  }

  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append(
    'set-cookie',
    'access_token=rotated-by-proxy; Path=/; Domain=.example.com; Secure; SameSite=None; HttpOnly',
  );
  headers.append('set-cookie', 'internal_trace=must-not-leak; Path=/');
  return new Response(JSON.stringify({ ok: true }), { headers });
}
