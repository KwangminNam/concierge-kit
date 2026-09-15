import {
  literalCookieNames,
  mergeIntoCookieHeader,
  pipeSetCookies,
  removeFromCookieHeader,
  type Relay,
  type RelayResult,
} from '@concierge-kit/core';
import type { EventHandler, H3Event } from 'h3';
import {
  appendSetCookie,
  setIncomingHeader,
  toContext,
  toEventHandler,
  toRequest,
} from './framework.js';
import { forwardFromEvent } from './forward.js';

/** What a rotation did. Cookie names only, never values. */
export interface RotateResult extends RelayResult {
  /** Names now visible to the rest of this request, before the browser has stored anything. */
  readonly rotated: string[];
}

/**
 * Relays a backend response's cookies to the browser **and** into the request still in flight.
 *
 * The h3 counterpart of the Next.js proxy rotation. The response gets `Set-Cookie` for the
 * browser, and the incoming `cookie` header is rewritten on the request object, so every
 * handler that runs after this one, and Nuxt's `useRequestHeaders`, already sees the new
 * value. Doing half of it fails silently in opposite directions.
 *
 * @see https://concierge-kit.dev/guides/proxy#nuxt
 */
export function rotateOnEvent(
  relay: Relay,
  event: H3Event,
  upstream: Response | Headers,
): RotateResult {
  const outgoing: string[] = [];
  const result = pipeSetCookies(
    upstream,
    ({ raw }) => void outgoing.push(raw),
    relay.options.cookie,
    toContext(event),
  );

  const merged = mergeIntoCookieHeader(toRequest(event).headers.get('cookie'), outgoing);
  setIncomingHeader(event, 'cookie', merged === '' ? null : merged);
  for (const raw of outgoing) appendSetCookie(event, raw);

  return { ...result, rotated: [...result.relayed] };
}

/**
 * Ends the session for the browser and for the request in flight at once.
 *
 * @see https://concierge-kit.dev/guides/proxy#clearing
 */
export function clearSessionOnEvent(
  event: H3Event,
  names: readonly string[],
  options?: { path?: string },
): void {
  const remaining = removeFromCookieHeader(toRequest(event).headers.get('cookie'), names);
  setIncomingHeader(event, 'cookie', remaining === '' ? null : remaining);
  for (const name of names) {
    appendSetCookie(event, `${name}=; Path=${options?.path ?? '/'}; Max-Age=0`);
  }
}

/** Options for {@link createRefreshMiddleware}. */
export interface RefreshOptions {
  /** Where the refresh call goes. */
  readonly endpoint: string | ((event: H3Event) => string | URL);
  /**
   * Whether this request should trigger a refresh. Required: a middleware with no condition
   * calls the backend on every request.
   */
  readonly when: (event: H3Event) => boolean;
  /** Extra `RequestInit` for the refresh call. @defaultValue `{ method: 'POST' }` */
  readonly init?: RequestInit;
  /**
   * What to do when the refresh call fails. `'continue'` (default) leaves the request as it
   * was; `'clear'` ends the session for browser and request at once; a function decides.
   */
  readonly onFailure?:
    'continue' | 'clear' | ((event: H3Event, upstream: Response) => void | Promise<void>);
  /** Names cleared by `'clear'`. @defaultValue the names stated outright in `cookie.allow` */
  readonly clear?: readonly string[];
  /** Receives what was relayed, dropped and rotated. */
  readonly onRotate?: (result: RotateResult) => void;
}

/**
 * Builds a middleware that refreshes a session and hands the result to the very request that
 * needed it. Register it before your routes, or from a nitro `request` hook.
 *
 * It never sends a response of its own, so h3 continues to the matching route once it returns.
 *
 * @example
 * ```ts
 * // server/middleware/refresh.ts
 * export default relay.refresh({
 *   endpoint: `${API}/auth/refresh`,
 *   when: (event) => !getCookie(event, 'access_token') && !!getCookie(event, 'refresh_token'),
 *   onFailure: 'clear',
 * });
 * ```
 *
 * @see https://concierge-kit.dev/guides/proxy#nuxt
 */
export function createRefreshMiddleware(relay: Relay, options: RefreshOptions): EventHandler {
  return toEventHandler(async (event) => {
    if (!options.when(event)) return;

    const target =
      typeof options.endpoint === 'function' ? options.endpoint(event) : options.endpoint;
    const upstream = await fetch(
      target.toString(),
      forwardFromEvent(relay, event, { method: 'POST', ...options.init }),
    );

    if (!upstream.ok) {
      const mode = options.onFailure ?? 'continue';
      if (typeof mode === 'function') await mode(event, upstream);
      else if (mode === 'clear') {
        clearSessionOnEvent(
          event,
          options.clear ?? literalCookieNames(relay.options.cookie?.allow),
        );
      }
      return;
    }

    const result = rotateOnEvent(relay, event, upstream);
    options.onRotate?.(result);
  });
}
