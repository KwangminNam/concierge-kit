import { matchCookie } from '../cookie/matchCookie.js';
import { DEADLINE_DEFAULTS } from '../deadline/deadline.js';
import { headersOfRequest } from '../internal/toHeaders.js';
import type { ForwardPolicy, HeaderInfo, RequestIdPolicy } from '../policy/types.js';
import { HOP_BY_HOP_HEADERS } from './hopByHop.js';

/**
 * Headers that never reach the backend, whatever the allow matcher says.
 *
 * `host` would make the backend route the call to this server. `content-length` describes a
 * body that is being re-encoded. `cookie` travels through the cookie policy, where the allow
 * list applies. The rest describe one network hop.
 */
export const NEVER_FORWARDED_HEADERS: readonly string[] = [
  ...HOP_BY_HOP_HEADERS,
  'host',
  'cookie',
  DEADLINE_DEFAULTS.carrier,
];

/**
 * Copies the allowed request headers onto a backend call.
 *
 * The usual bug this replaces is forwarding `request.headers` wholesale: `host` sends the call
 * back to the frontend, `content-length` lies about a re-encoded body, and `connection` has no
 * meaning on the next hop. Here the matcher chooses and the deny list stands guard.
 *
 * @example
 * ```ts
 * forwardRequestHeaders(request, init, { headers: ['accept-language', /^x-trace-/] });
 * ```
 *
 * @see https://concierge-kit.dev/reference/forward#headers
 */
export function forwardRequestHeaders(
  from: Request | Headers,
  init: RequestInit | undefined,
  policy: ForwardPolicy | undefined,
  carrier: string = DEADLINE_DEFAULTS.carrier,
): RequestInit {
  const matcher = policy?.headers;
  if (matcher === undefined) return { ...init };

  const source = headersOfRequest(from);
  const headers = new Headers(init?.headers);
  const deny = new Set([...NEVER_FORWARDED_HEADERS, carrier.toLowerCase()]);

  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (deny.has(lower)) continue;
    if (headers.has(lower)) continue; // the caller's own header wins
    if (!matchCookie<HeaderInfo>({ name: lower }, normalize(matcher))) continue;
    headers.set(lower, value);
  }

  return { ...init, headers };
}

/**
 * Makes sure a request carries a correlation id, and returns it.
 *
 * Keeps the id the browser sent when there is one, so a trace started in the browser is not
 * cut here. Mints one otherwise. Writes it onto `headers`, which is why a proxy calling this
 * lets the render that follows read the same id.
 *
 * @see https://concierge-kit.dev/reference/forward#requestid
 */
export function ensureRequestId(headers: Headers, policy: RequestIdPolicy): string {
  const existing = headers.get(policy.header);
  if (existing !== null && existing.trim() !== '') return existing;
  const id = (policy.generate ?? (() => crypto.randomUUID()))();
  headers.set(policy.header, id);
  return id;
}

/** Applies the correlation id to a backend call, minting one when the request has none. */
export function forwardRequestId(
  from: Request | Headers,
  init: RequestInit | undefined,
  policy: RequestIdPolicy | undefined,
): RequestInit {
  if (policy === undefined) return { ...init };
  const headers = new Headers(init?.headers);
  if (headers.has(policy.header)) return { ...init, headers };

  const incoming = headersOfRequest(from).get(policy.header);
  headers.set(
    policy.header,
    incoming !== null && incoming.trim() !== ''
      ? incoming
      : (policy.generate ?? (() => crypto.randomUUID()))(),
  );
  return { ...init, headers };
}

/** String matchers compare lowercased, so `'Accept-Language'` still matches. */
function normalize(
  matcher: NonNullable<ForwardPolicy['headers']>,
): NonNullable<ForwardPolicy['headers']> {
  if (typeof matcher === 'string') return matcher.toLowerCase();
  if (Array.isArray(matcher)) {
    return matcher.map((one) => (typeof one === 'string' ? one.toLowerCase() : one));
  }
  return matcher;
}
