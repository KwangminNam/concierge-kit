import {
  literalCookieNames,
  mergeIntoCookieHeader,
  pipeSetCookies,
  removeFromCookieHeader,
  resolveRelayContext,
  stampDeadline,
  type Relay,
  type RelayResult,
} from '@concierge-kit/core';
import type { NextRequest, NextResponse } from 'next/server';
import { continueRequest } from './framework.js';

/** What a rotation did. Cookie names only, never values. */
export interface RotateResult extends RelayResult {
  /** Names now visible to the rest of this request, before the browser has stored anything. */
  readonly rotated: string[];
}

/** Options for {@link rotateFromUpstream}. */
export interface RotateOptions {
  /** Receives what was relayed, dropped and rotated. */
  readonly onRotate?: (result: RotateResult) => void;
}

/**
 * Relays a backend response's cookies to the browser **and** into the request still in flight.
 *
 * This is the one thing no other call site can do. A route handler or a server action writes a
 * cookie the browser will send back on the *next* request; a React Server Component render
 * cannot write one at all. Here, the response carries `Set-Cookie` for the browser while the
 * incoming `cookie` header is rewritten, so the render that follows in this same request already
 * reads the new value.
 *
 * Doing only half of that fails silently, in opposite directions: rewrite the request alone and
 * the browser never stores the cookie, write the response alone and this render keeps using the
 * old one.
 *
 * @example
 * ```ts
 * // proxy.ts
 * export async function proxy(request: NextRequest) {
 *   const upstream = await fetch(`${API}/auth/refresh`, relay.forwardCookies(request, { method: 'POST' }));
 *   return rotateFromUpstream(relay, request, upstream);
 * }
 * ```
 *
 * @see https://concierge-kit.dev/guides/proxy
 */
export function rotateFromUpstream(
  relay: Relay,
  request: NextRequest,
  upstream: Response | Headers,
  options?: RotateOptions,
): NextResponse {
  const outgoing: string[] = [];
  const result = pipeSetCookies(
    upstream,
    ({ raw }) => void outgoing.push(raw),
    relay.options.cookie,
    resolveRelayContext(request),
  );

  const headers = stampedHeaders(relay, request);
  applyCookieHeader(headers, mergeIntoCookieHeader(headers.get('cookie'), outgoing));

  const response = continueRequest(headers);
  for (const raw of outgoing) response.headers.append('set-cookie', raw);

  const rotated: RotateResult = { ...result, rotated: [...result.relayed] };
  options?.onRotate?.(rotated);
  return response;
}

/**
 * Ends the session for the request in flight as well as for the browser.
 *
 * The named cookies are expired on the response and removed from the incoming `cookie` header,
 * so the render that follows already sees a logged out request rather than one more render with
 * a token the backend has just rejected.
 *
 * @see https://concierge-kit.dev/guides/proxy#clearing
 */
export function clearSession(
  relay: Relay,
  request: NextRequest,
  names: readonly string[],
  options?: { path?: string },
): NextResponse {
  const headers = stampedHeaders(relay, request);
  applyCookieHeader(headers, removeFromCookieHeader(headers.get('cookie'), names));

  const response = continueRequest(headers);
  for (const name of names) {
    response.headers.append('set-cookie', `${name}=; Path=${options?.path ?? '/'}; Max-Age=0`);
  }
  return response;
}

function applyCookieHeader(headers: Headers, value: string): void {
  if (value === '') headers.delete('cookie');
  else headers.set('cookie', value);
}

/**
 * The incoming headers, with the request's time budget stamped on when one is configured.
 *
 * Every path out of the proxy goes through here, so a request that needed no refresh still
 * gets its budget. The stamp always overwrites: a deadline arriving from outside is not one
 * this server agreed to.
 */
function stampedHeaders(relay: Relay, request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  if (relay.options.deadline !== undefined) stampDeadline(headers, relay.options.deadline);
  return headers;
}

/**
 * Starts this request's time budget and nothing else. For a proxy of your own that does not
 * refresh sessions but still wants every backend call under one budget.
 *
 * @example
 * ```ts
 * export function proxy(request: NextRequest) {
 *   return stampRequest(relay, request);
 * }
 * ```
 *
 * @see https://concierge-kit.dev/reference/deadline#next
 */
export function stampRequest(relay: Relay, request: NextRequest): NextResponse {
  if (relay.options.deadline === undefined) return continueRequest();
  return continueRequest(stampedHeaders(relay, request));
}

/** Options for {@link createProxy}. */
export interface ProxyOptions {
  /** Where the refresh call goes. */
  readonly endpoint: string | ((request: NextRequest) => string | URL);
  /**
   * Whether this request should trigger a refresh. Required, and deliberately so: a proxy with
   * no condition calls the backend on every navigation, which is an expensive default to
   * arrive at by accident.
   */
  readonly when: (request: NextRequest) => boolean;
  /** Extra `RequestInit` for the refresh call. @defaultValue `{ method: 'POST' }` */
  readonly init?: RequestInit;
  /**
   * What to do when the refresh call fails.
   *
   * - `'continue'` (default) leaves the request untouched, so the app sees the state it had.
   * - `'clear'` expires the session cookies for the browser and for this request at once.
   * - A function decides for itself.
   */
  readonly onFailure?:
    | 'continue'
    | 'clear'
    | ((request: NextRequest, upstream: Response) => NextResponse | Promise<NextResponse>);
  /**
   * Names cleared by `'clear'`.
   * @defaultValue the names stated outright in the relay's `cookie.allow`
   */
  readonly clear?: readonly string[];
  /** Receives what was relayed, dropped and rotated. */
  readonly onRotate?: (result: RotateResult) => void;
}

/**
 * Builds a proxy that refreshes a session and hands the result to the very request that needed it.
 *
 * @example
 * ```ts
 * // proxy.ts
 * import { relay } from '@/lib/relay';
 *
 * export const proxy = relay.proxy({
 *   endpoint: `${API}/auth/refresh`,
 *   when: (request) =>
 *     !request.cookies.has('access_token') && request.cookies.has('refresh_token'),
 *   onFailure: 'clear',
 * });
 *
 * export const config = { matcher: ['/((?!_next|favicon.ico).*)'] };
 * ```
 *
 * @see https://concierge-kit.dev/guides/proxy
 */
export function createProxy(
  relay: Relay,
  options: ProxyOptions,
): (request: NextRequest) => Promise<NextResponse> {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    if (!options.when(request)) return stampRequest(relay, request);

    const target =
      typeof options.endpoint === 'function' ? options.endpoint(request) : options.endpoint;

    const upstream = await fetch(
      target.toString(),
      relay.forwardCookies(request, { method: 'POST', ...options.init }),
    );

    if (!upstream.ok) return handleFailure(relay, request, upstream, options);

    return rotateFromUpstream(
      relay,
      request,
      upstream,
      options.onRotate ? { onRotate: options.onRotate } : undefined,
    );
  };
}

async function handleFailure(
  relay: Relay,
  request: NextRequest,
  upstream: Response,
  options: ProxyOptions,
): Promise<NextResponse> {
  const mode = options.onFailure ?? 'continue';
  if (typeof mode === 'function') return mode(request, upstream);
  if (mode === 'clear') {
    return clearSession(
      relay,
      request,
      options.clear ?? literalCookieNames(relay.options.cookie?.allow),
    );
  }
  return stampRequest(relay, request);
}
