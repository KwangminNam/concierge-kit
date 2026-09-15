import type { Relay } from '@concierge-kit/core';
import { readRequestHeaders } from './framework.js';

/**
 * Builds the `RequestInit` for a backend call: the browser's allowed cookies, and what is left
 * of the request's time budget when a deadline is configured.
 *
 * Pass the request when you have one. In a server action you do not, so leave it out and the
 * adapter reads the ambient request headers instead. An explicit request always wins.
 *
 * @example
 * ```ts
 * const upstream = await fetch(`${API}/me`, await relay.forward(request));
 * ```
 *
 * @see https://concierge-kit.dev/reference/next#forward
 */
export async function forwardFromRequest(
  relay: Relay,
  request?: Request,
  init?: RequestInit,
): Promise<RequestInit> {
  const source = request ?? (await readRequestHeaders());
  return relay.forwardRequest(source, init);
}
