import type { Relay } from '@conciergekit/core';
import { readRequestHeaders } from './framework.js';

/**
 * Builds the `RequestInit` for a backend call, carrying the browser's allowed cookies.
 *
 * Pass the request when you have one. In a server action you do not, so leave it out and the
 * adapter reads the ambient request headers instead. An explicit request always wins.
 *
 * @example
 * ```ts
 * const upstream = await fetch(`${API}/me`, await relay.forward(request));
 * ```
 *
 * @see https://conciergekit.dev/reference/next#forward
 */
export async function forwardFromRequest(
  relay: Relay,
  request?: Request,
  init?: RequestInit,
): Promise<RequestInit> {
  const source = request ?? (await readRequestHeaders());
  return relay.forwardCookies(source, init);
}
