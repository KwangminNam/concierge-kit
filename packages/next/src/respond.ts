import {
  resolveRelayContext,
  type Relay,
  type RelayContext,
  type RelayCookieNames,
  type RelayOptions,
  type RelayResult,
} from '@concierge-kit/core';
import { createResponse, readRequestHeaders } from './framework.js';

/** Options for {@link toNextResponse}. */
export interface RespondOptions<N extends string = string> {
  /** Request information for the `'auto'` rules. Resolved from the current request when absent. */
  readonly context?: RelayContext;
  /** The incoming request, used to derive the context when one is not supplied directly. */
  readonly request?: Request;
  /** Overrides the upstream status. */
  readonly status?: number;
  /** Extra headers set on the outgoing response, after the upstream ones are copied. */
  readonly headers?: HeadersInit;
  /** Receives what was relayed and what was dropped. Names and reasons only, never values. */
  readonly onRelay?: (result: RelayResult<N>) => void;
}

/**
 * Turns a backend response into the response a route handler returns, relaying cookies on the way.
 *
 * This is the path to prefer. Cookies are appended to the response headers as the raw strings
 * the backend sent, so two cookies that share a name but differ in `Path` both survive, and
 * attributes concierge-kit has never heard of survive with them.
 *
 * Hop-by-hop headers are dropped, and so is every upstream `Set-Cookie`, which is then put back
 * one at a time by the allow policy. Without that, a backend that sets an internal cookie would
 * leak it to the browser.
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   const upstream = await fetch(`${API}/login`, await relay.forward(request, { method: 'POST' }));
 *   return relay.respond(upstream);
 * }
 * ```
 *
 * @see https://concierge-kit.dev/guides/route-handlers
 */
export async function toNextResponse<O extends RelayOptions>(
  upstream: Response,
  relay: Relay<O>,
  options?: RespondOptions<RelayCookieNames<O>>,
): Promise<Response> {
  const headers = relay.prepareHeaders(upstream.headers);
  if (options?.headers !== undefined) {
    for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  }

  const context = options?.context ?? (await resolveContext(options?.request));
  const result = relay.relayCookies(upstream, headers, context);
  options?.onRelay?.(result);

  return createResponse(upstream.body, {
    status: options?.status ?? upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/**
 * The request context, from an explicit request when there is one and from the ambient
 * request otherwise. Returns `undefined` outside a request, where every `'auto'` rule then
 * leaves the cookie as the backend wrote it.
 */
export async function resolveContext(request?: Request): Promise<RelayContext | undefined> {
  if (request !== undefined) return resolveRelayContext(request);
  try {
    return resolveRelayContext(await readRequestHeaders());
  } catch {
    return undefined;
  }
}
