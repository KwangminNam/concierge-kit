import type { Relay } from '@concierge-kit/core';
import type { H3Event } from 'h3';
import { toRequest } from './framework.js';

/**
 * Builds the `RequestInit` for a backend call, carrying the browser's allowed cookies.
 *
 * Synchronous, unlike the Next.js adapter: h3 hands you the request directly, so nothing has to
 * be awaited to find out who is calling.
 *
 * The result is a plain `RequestInit`, and the only thing this package puts in it is a `cookie`
 * header. Take that header out and hand it to any client if you do not use `fetch`.
 *
 * @example
 * ```ts
 * const upstream = await fetch(`${API}/me`, relay.forward(event));
 * ```
 *
 * @see https://concierge-kit.dev/reference/h3#forward
 */
export function forwardFromEvent(relay: Relay, event: H3Event, init?: RequestInit): RequestInit {
  return relay.forwardCookies(toRequest(event), init);
}
