/**
 * The fake backend. Sets cookies exactly as the query string asks, plus one internal cookie
 * that must never reach the browser.
 */
function build(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const attributes = [`Path=${params.get('path') ?? '/'}`];
  const domain = params.get('domain');
  const sameSite = params.get('samesite');
  if (domain) attributes.push(`Domain=${domain}`);
  if (params.get('secure') === '1') attributes.push('Secure');
  if (sameSite) attributes.push(`SameSite=${sameSite}`);
  if (params.get('partitioned') === '1') attributes.push('Partitioned');
  attributes.push('HttpOnly');

  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append(
    'set-cookie',
    `access_token=${params.get('value') ?? 'granted'}; ${attributes.join('; ')}`,
  );
  headers.append('set-cookie', 'internal_trace=must-not-leak; Path=/');

  return new Response(JSON.stringify({ ok: true, from: 'backend' }), { status: 200, headers });
}

export const GET = build;
export const POST = build;
