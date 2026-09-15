import {
  appendResponseHeader,
  defineEventHandler,
  getRequestHost,
  getRequestProtocol,
  getRequestURL,
  sendWebResponse,
  toWebRequest,
  type EventHandler,
  type H3Event,
} from 'h3';
import {
  stampDeadline,
  DEADLINE_DEFAULTS,
  type DeadlinePolicy,
  type RelayContext,
} from '@concierge-kit/core';

/**
 * The one and only place in this package that touches an h3 API.
 *
 * A breaking change in h3 lands in this file and nowhere else, which is what makes the h3 v2
 * move a change to one file rather than a change everywhere. It is also the test seam.
 *
 * @see https://concierge-kit.dev/reference/h3#framework
 */

/** The incoming request as a web standard `Request`. */
export function toRequest(event: H3Event): Request {
  return toWebRequest(event);
}

/**
 * What the `'auto'` rules judge against.
 *
 * h3 resolves the protocol from `x-forwarded-proto` before the socket, which is the order this
 * package needs: behind a proxy the socket is plain http even when the browser used https.
 */
export function toContext(event: H3Event): RelayContext {
  return { proto: getRequestProtocol(event), host: getRequestHost(event) };
}

/**
 * Appends one `Set-Cookie` to the response being built.
 *
 * Appending through h3 rather than touching `event.node.res` directly is deliberate: writing to
 * the low level response by hand can finish it before queued cookies flush, and they vanish.
 */
export function appendSetCookie(event: H3Event, raw: string): void {
  appendResponseHeader(event, 'set-cookie', raw);
}

/** Sends a complete web `Response` as the answer. */
export async function sendResponse(event: H3Event, response: Response): Promise<void> {
  await sendWebResponse(event, response);
}

/** The URL the browser asked for, which a passthrough route copies the query string from. */
export function requestUrl(event: H3Event): URL {
  return getRequestURL(event);
}

/** Wraps a function as an h3 handler. */
export function toEventHandler(handler: (event: H3Event) => Promise<unknown>): EventHandler {
  return defineEventHandler(handler);
}

const DEADLINE_KEY = 'conciergeKitDeadlineAt';

/**
 * The request headers with this request's time budget stamped on.
 *
 * h3 has a real per-request scope, `event.context`, so the clock starts the first time anyone
 * asks and every later call in the same request reads the same deadline. A carrier header
 * arriving from outside is ignored: a budget this server did not set is not one it honours.
 */
export function stampedRequestHeaders(
  event: H3Event,
  policy: DeadlinePolicy,
  now: number = Date.now(),
): Headers {
  const headers = new Headers(toWebRequest(event).headers);
  const carrier = policy.carrier ?? DEADLINE_DEFAULTS.carrier;
  const existing = event.context[DEADLINE_KEY];
  if (typeof existing === 'number') {
    headers.set(carrier, String(existing));
  } else {
    event.context[DEADLINE_KEY] = stampDeadline(headers, policy, now).at;
  }
  return headers;
}
