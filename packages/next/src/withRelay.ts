import {
  resolveRelayContext,
  type Relay,
  type RelayContext,
  type RelayResult,
} from '@conciergekit/core';
import { toNextResponse } from './respond.js';

/** The relay helpers handed to a wrapped handler. */
export interface RelayHandlerContext {
  /** Request information for the `'auto'` rules, already resolved from this request. */
  readonly context: RelayContext | undefined;
  /** Builds the `RequestInit` for a backend call with the browser's allowed cookies. */
  forward(init?: RequestInit): RequestInit;
  /**
   * Queues the allowed cookies of a backend response onto whatever response the handler
   * returns. Use it when you want to answer with your own body but the backend's cookies.
   */
  relayFrom(upstream: Response): RelayResult;
  /** Returns the backend response as is, cookies relayed. */
  respond(upstream: Response, status?: number): Promise<Response>;
}

/** A handler written against {@link RelayHandlerContext}. */
export type RelayHandler<A extends unknown[] = []> = (
  request: Request,
  relay: RelayHandlerContext,
  ...rest: A
) => Promise<Response> | Response;

/**
 * Wraps a route handler so the cookies it queues are attached to whatever response it returns.
 *
 * The wrapped handler keeps full control of status and body, which the passthrough factory
 * does not, while still never touching a header by hand.
 *
 * @example
 * ```ts
 * export const POST = withRelay(relay, async (request, { forward, relayFrom }) => {
 *   const upstream = await fetch(`${API}/login`, forward({ method: 'POST', body: request.body }));
 *   relayFrom(upstream);
 *   return NextResponse.json({ ok: upstream.ok });
 * });
 * ```
 *
 * @see https://conciergekit.dev/reference/next#withrelay
 */
export function withRelay<A extends unknown[] = []>(
  relay: Relay,
  handler: RelayHandler<A>,
): (request: Request, ...rest: A) => Promise<Response> {
  return async function wrapped(request: Request, ...rest: A): Promise<Response> {
    const context = resolveRelayContext(request);
    const queued = new Headers();

    const helpers: RelayHandlerContext = {
      context,
      forward: (init) => relay.forwardCookies(request, init),
      relayFrom: (upstream) => relay.relayCookies(upstream, queued, context),
      respond: (upstream, status) =>
        toNextResponse(upstream, relay, {
          context,
          ...(status === undefined ? {} : { status }),
        }),
    };

    const response = await handler(request, helpers, ...rest);
    const pending = queued.getSetCookie();
    if (pending.length === 0) return response;

    const headers = new Headers(response.headers);
    for (const cookie of pending) headers.append('set-cookie', cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
