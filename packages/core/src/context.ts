/**
 * The small amount of request information the `'auto'` rules need.
 *
 * The core cannot ask a framework what request it is handling, so this is passed in.
 * Adapters fill it automatically; pure-function users pass it themselves.
 *
 * @see https://concierge-kit.dev/reference/relay-context
 */
import { headersOfRequest } from './internal/toHeaders.js';

export interface RelayContext {
  /** Scheme the browser used to reach this server. */
  readonly proto: 'http' | 'https';
  /** Host the browser used, port included when there was one. */
  readonly host: string;
}

/**
 * Derives a {@link RelayContext} from an incoming request.
 *
 * The proxy headers win over the request URL on purpose: inside a container the URL is
 * almost always plain http even when the browser used https, so trusting the URL first
 * would strip `Secure` from every cookie in production.
 *
 * Returns `undefined` when neither source says anything, in which case every `'auto'` rule
 * falls back to leaving the cookie untouched.
 *
 * @see https://concierge-kit.dev/reference/relay-context#resolve
 */
export function resolveRelayContext(from: Request | Headers): RelayContext | undefined {
  const headers = headersOfRequest(from);
  const url = 'url' in from && typeof from.url === 'string' ? from.url : undefined;

  const forwardedProto = firstToken(headers.get('x-forwarded-proto'));
  const forwardedHost = firstToken(headers.get('x-forwarded-host'));

  let proto: 'http' | 'https' | undefined =
    forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : undefined;
  let host = forwardedHost ?? headers.get('host') ?? undefined;

  if ((proto === undefined || host === undefined) && url !== undefined) {
    try {
      const parsed = new URL(url);
      proto ??= parsed.protocol === 'https:' ? 'https' : 'http';
      host ??= parsed.host;
    } catch {
      // A relative or malformed URL tells us nothing. Leave what we have.
    }
  }

  if (proto === undefined && host === undefined) return undefined;
  return { proto: proto ?? 'http', host: host ?? '' };
}

function firstToken(value: string | null): string | undefined {
  if (value === null) return undefined;
  const first = value.split(',')[0]?.trim().toLowerCase();
  return first === undefined || first === '' ? undefined : first;
}

/**
 * Host portion of an authority, lowercased and without the port.
 * Handles bracketed IPv6 literals such as `[::1]:3000`.
 */
export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close === -1 ? trimmed.toLowerCase() : trimmed.slice(0, close + 1).toLowerCase();
  }
  const colon = trimmed.indexOf(':');
  return (colon === -1 ? trimmed : trimmed.slice(0, colon)).toLowerCase();
}

/**
 * Whether a browser on `host` would accept a cookie carrying `Domain=domain`,
 * following the domain-match rule of RFC 6265 section 5.1.3.
 */
export function domainMatches(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain.startsWith('.') ? domain.slice(1) : domain);
  if (h === '' || d === '') return false;
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Whether browsers treat this host as a secure context even over plain http.
 *
 * `localhost`, any `*.localhost`, the whole `127.0.0.0/8` block and `[::1]` all qualify, so a
 * `Secure` cookie set there is stored. Stripping `Secure` on these hosts would not help and
 * would break every cookie that requires it, such as `Partitioned` and `__Host-` ones.
 */
export function isLoopbackHost(host: string): boolean {
  const h = normalizeHost(host);
  if (h === 'localhost' || h.endsWith('.localhost') || h === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}
