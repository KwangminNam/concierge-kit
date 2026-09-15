import {
  DEADLINE_DEFAULTS,
  ensureRequestId,
  readDeadline,
  stampDeadline,
  type Relay,
} from '@concierge-kit/core';
import { readRequestHeaders } from './framework.js';

/**
 * What this request started here rather than in a proxy: its clock and its correlation id.
 *
 * Keyed on the request object, or on the ambient headers object when there is no request:
 * Next hands back the same headers object for the whole request, so every call in a route
 * handler or a server action reads the same values. A proxy stamp always wins, because it
 * came first.
 */
interface Started {
  deadlineAt?: number;
  requestId?: string;
}
const started = new WeakMap<object, Started>();

/**
 * Builds the `RequestInit` for a backend call: the browser's allowed cookies, the allowed
 * request headers, a correlation id, and what is left of the request's time budget.
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
  return relay.forwardRequest(withRequestScope(relay, source), init);
}

/**
 * The headers to forward from, carrying the deadline stamp and the correlation id.
 *
 * Values the proxy stamped are kept. Without them, they start at the first call of this
 * request and every later call shares them, so a route handler or a server action works
 * without a proxy at all.
 */
function withRequestScope(relay: Relay, source: Request | Headers): Request | Headers {
  const deadline = relay.options.deadline;
  const requestId = relay.options.forward?.requestId;
  const needsDeadline = deadline !== undefined && readDeadline(source, deadline) === undefined;
  const needsId = requestId !== undefined;
  if (!needsDeadline && !needsId) return source;

  const headers = new Headers(
    typeof (source as Request).url === 'string' ? (source as Request).headers : (source as Headers),
  );
  const record = started.get(source) ?? {};
  started.set(source, record);

  if (needsDeadline && deadline !== undefined) {
    if (record.deadlineAt === undefined) record.deadlineAt = stampDeadline(headers, deadline).at;
    else headers.set(deadline.carrier ?? DEADLINE_DEFAULTS.carrier, String(record.deadlineAt));
  }
  if (requestId !== undefined) {
    if (record.requestId === undefined) record.requestId = ensureRequestId(headers, requestId);
    else headers.set(requestId.header, record.requestId);
  }
  return headers;
}
