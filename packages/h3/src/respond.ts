import type { Relay, RelayContext, RelayResult } from '@concierge-kit/core';
import type { H3Event } from 'h3';
import { sendResponse, toContext } from './framework.js';

/** Options for {@link respondWithUpstream}. */
export interface RespondOptions {
  /** Request information for the `'auto'` rules. Read from the event when absent. */
  readonly context?: RelayContext;
  /** Overrides the upstream status. */
  readonly status?: number;
  /** Extra headers set on the outgoing response, after the upstream ones are copied. */
  readonly headers?: HeadersInit;
  /** Receives what was relayed and what was dropped. Names and reasons only, never values. */
  readonly onRelay?: (result: RelayResult) => void;
}

/**
 * Sends a backend response to the browser as it arrived, cookies relayed.
 *
 * Hop-by-hop headers are dropped, and so is every upstream `Set-Cookie`, which is then put back
 * one at a time by the allow policy. Without that, a backend that sets an internal cookie would
 * leak it to the browser.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
 *   return relay.respond(event, upstream);
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/h3#respond
 */
export async function respondWithUpstream(
  relay: Relay,
  event: H3Event,
  upstream: Response,
  options?: RespondOptions,
): Promise<void> {
  const headers = relay.prepareHeaders(upstream.headers);
  if (options?.headers !== undefined) {
    for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  }

  const result = relay.relayCookies(upstream, headers, options?.context ?? toContext(event));
  options?.onRelay?.(result);

  await sendResponse(
    event,
    new Response(upstream.body, {
      status: options?.status ?? upstream.status,
      statusText: upstream.statusText,
      headers,
    }),
  );
}
