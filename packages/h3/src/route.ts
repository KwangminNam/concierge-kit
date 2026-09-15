import type { Relay, RelayResult } from '@concierge-kit/core';
import type { EventHandler, H3Event } from 'h3';
import { requestUrl, toEventHandler, toRequest } from './framework.js';
import { respondWithUpstream } from './respond.js';

/** Where a passthrough route sends the request. */
export type RouteTarget = string | URL | ((event: H3Event) => string | URL);

/** Options for {@link createPassthroughRoute}. */
export interface RouteOptions {
  /**
   * Request header names copied to the backend call.
   *
   * Kept deliberately short in this release. General header propagation, including correlation
   * ids and forwarded headers, is a separate feature rather than a silent default here.
   *
   * @defaultValue `['content-type', 'accept']`
   */
  readonly headers?: readonly string[];
  /** Whether the incoming query string is appended to a target that has none. @defaultValue `true` */
  readonly searchParams?: boolean;
  /** Extra `RequestInit` merged into the backend call. */
  readonly init?: RequestInit;
  /** Receives what was relayed and what was dropped. */
  readonly onRelay?: (result: RelayResult) => void;
}

const DEFAULT_FORWARDED_HEADERS = ['content-type', 'accept'] as const;
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/**
 * Builds an event handler that hands the request to the backend and the answer back, relaying
 * cookies both ways. Turns a pure passthrough route file into a single re-export.
 *
 * Redirects are not followed, so a backend that answers a login with a 302 and a cookie reaches
 * the browser as a 302 and a cookie.
 *
 * @example
 * ```ts
 * // server/api/login.post.ts
 * export default relay.route(`${API}/login`);
 * ```
 *
 * @see https://concierge-kit.dev/reference/h3#route
 */
export function createPassthroughRoute(
  relay: Relay,
  target: RouteTarget,
  options?: RouteOptions,
): EventHandler {
  const allowedHeaders = options?.headers ?? DEFAULT_FORWARDED_HEADERS;

  return toEventHandler(async (event) => {
    const request = toRequest(event);
    const url = resolveTarget(target, event, options?.searchParams !== false);

    const headers = new Headers();
    for (const name of allowedHeaders) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }

    const init = relay.forwardRequest(request, {
      redirect: 'manual',
      ...options?.init,
      method: request.method,
      headers,
      ...(BODYLESS_METHODS.has(request.method) ? {} : { body: request.body }),
    });

    const upstream = await fetch(url, init);
    await respondWithUpstream(
      relay,
      event,
      upstream,
      options?.onRelay ? { onRelay: options.onRelay } : undefined,
    );
  });
}

function resolveTarget(target: RouteTarget, event: H3Event, withSearch: boolean): string {
  const resolved = typeof target === 'function' ? target(event) : target;
  const url = new URL(resolved.toString());
  if (withSearch && url.search === '') {
    url.search = requestUrl(event).search;
  }
  return url.toString();
}
