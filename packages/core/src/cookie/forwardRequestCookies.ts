import { headersOfRequest } from '../internal/toHeaders.js';
import type { CookieInfo, ForwardPolicy } from '../policy/types.js';
import { matchCookie } from './matchCookie.js';

/**
 * Builds the `RequestInit` for a backend call, carrying the browser's cookies along.
 *
 * A server `fetch` has no cookie jar, so a cookie the browser sent to this server does not
 * travel any further on its own. This puts the allowed ones back on the outgoing request.
 *
 * The caller's own `cookie` header wins: when nothing matches the policy, an existing header
 * in `init` is left exactly as it was.
 *
 * @example
 * ```ts
 * const upstream = await fetch(`${API}/me`, forwardRequestCookies(request, {}, { cookies: ['access_token'] }));
 * ```
 *
 * @see https://concierge-kit.dev/reference/cookie#forwardrequestcookies
 */
export function forwardRequestCookies(
  from: Request | Headers,
  init?: RequestInit,
  policy?: ForwardPolicy,
): RequestInit {
  const source = headersOfRequest(from);
  const headers = new Headers(init?.headers);
  const rename = policy?.rename?.toUpstream;

  const forwarded: string[] = [];
  for (const cookie of parseCookieHeader(source.get('cookie'))) {
    if (!matchCookie<CookieInfo>({ name: cookie.name }, policy?.cookies)) continue;
    const name = rename?.(cookie.name) ?? cookie.name;
    forwarded.push(`${name}=${cookie.value}`);
  }

  if (forwarded.length > 0) headers.set('cookie', forwarded.join('; '));

  const next: RequestInit = { ...init, headers };
  // A streamed request body is rejected by Node's fetch unless the half duplex mode is stated.
  if (isStream(next.body) && (next as { duplex?: string }).duplex === undefined) {
    (next as { duplex?: string }).duplex = 'half';
  }
  return next;
}

interface ParsedCookie {
  readonly name: string;
  /** Kept only long enough to rebuild the header. It is never logged or returned. */
  readonly value: string;
}

/**
 * Splits a `Cookie` request header into pairs. Far simpler than `Set-Cookie`: no attributes,
 * and a value may itself contain `=`, so only the first one separates.
 */
export function parseCookieHeader(header: string | null): ParsedCookie[] {
  if (header === null || header === '') return [];
  const out: ParsedCookie[] = [];
  for (const part of header.split(';')) {
    const segment = part.trim();
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    out.push({ name: segment.slice(0, eq).trim(), value: segment.slice(eq + 1) });
  }
  return out;
}

function isStream(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ReadableStream).getReader === 'function'
  );
}
