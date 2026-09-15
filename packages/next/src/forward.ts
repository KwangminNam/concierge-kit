import { DEADLINE_DEFAULTS, readDeadline, stampDeadline, type Relay } from '@concierge-kit/core';
import { readRequestHeaders } from './framework.js';

/**
 * Deadlines started here rather than by a proxy, one per request.
 *
 * Keyed on the request object, or on the ambient headers object when there is no request:
 * Next hands back the same headers object for the whole request, so every call in a route
 * handler or a server action reads the same clock. A proxy stamp always wins, because it
 * started earlier.
 */
const started = new WeakMap<object, number>();

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
  return relay.forwardRequest(withDeadline(relay, source), init);
}

/**
 * The headers to forward from, carrying a deadline stamp when a policy exists.
 *
 * A stamp the proxy made is kept. Without one, the clock starts at the first call of this
 * request and every later call shares it, so a route handler or a server action gets one
 * budget without needing a proxy at all.
 */
function withDeadline(relay: Relay, source: Request | Headers): Request | Headers {
  const policy = relay.options.deadline;
  if (policy === undefined || readDeadline(source, policy) !== undefined) return source;

  const headers = new Headers(
    typeof (source as Request).url === 'string' ? (source as Request).headers : (source as Headers),
  );
  const at = started.get(source);
  if (at === undefined) {
    started.set(source, stampDeadline(headers, policy).at);
  } else {
    headers.set(policy.carrier ?? DEADLINE_DEFAULTS.carrier, String(at));
  }
  return headers;
}
