import type { Relay } from '@concierge-kit/core';
import type { H3Event } from 'h3';
import { requestIdOf, stampedRequestHeaders, toRequest } from './framework.js';

/**
 * Builds the `RequestInit` for a backend call: the browser's allowed cookies, and what is left
 * of the request's time budget when a deadline is configured.
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
  const requestId = relay.options.forward?.requestId;
  if (requestId !== undefined) requestIdOf(event, requestId);
  const policy = relay.options.deadline;
  const source = policy === undefined ? toRequest(event) : stampedRequestHeaders(event, policy);
  return relay.forwardRequest(source, init);
}

/**
 * Starts this request's time budget now, for a nitro `onRequest` hook that wants the clock to
 * run from the moment the request arrived rather than from the first backend call.
 *
 * @example
 * ```ts
 * // server/plugins/deadline.ts
 * export default defineNitroPlugin((nitro) => {
 *   nitro.hooks.hook('request', (event) => stampEvent(relay, event));
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/deadline#h3
 */
export function stampEvent(relay: Relay, event: H3Event): void {
  if (relay.options.deadline !== undefined) stampedRequestHeaders(event, relay.options.deadline);
}
