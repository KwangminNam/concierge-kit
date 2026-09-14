import { relay, BACKEND } from '@/lib/relay';

/**
 * The only layer that can hand a cookie to the render happening right now.
 *
 * A route handler or a server action writes a cookie the browser sends back on the next request.
 * A server component render cannot write one at all. Here the response carries Set-Cookie for
 * the browser while the incoming cookie header is rewritten, so this same request already sees
 * the rotated token.
 */
export const proxy = relay.proxy({
  endpoint: `${BACKEND}/backend/refresh`,
  when: (request) => !request.cookies.has('access_token') && request.cookies.has('refresh_token'),
  onFailure: 'clear',
});

export const config = { matcher: ['/session'] };
