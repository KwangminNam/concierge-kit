import type { RelayContext } from './context.js';
import { forwardRequestCookies } from './cookie/forwardRequestCookies.js';
import { readDeadline, viewDeadline, type DeadlineView } from './deadline/deadline.js';
import { forwardRequest } from './forwardRequest.js';
import { relaySetCookies } from './cookie/relaySetCookies.js';
import { prepareResponseHeaders } from './headers/hopByHop.js';
import type { StrictRelayOptions } from './policy/strict.js';
import { validateRelayOptions } from './policy/validate.js';
import type { RelayOptions, RelayResult, RelayedNames } from './policy/types.js';

/** The cookie names a relay built from these options can report. */
export type RelayCookieNames<O> = O extends { cookie: infer C } ? RelayedNames<C> : string;

/**
 * A relay carrying the policy for a whole application, so call sites stay one line.
 *
 * This is the headless half: it knows nothing about any framework and works anywhere
 * `Request`, `Response` and `Headers` exist. Framework adapters wrap it and add the
 * request-shaped conveniences.
 *
 * @see https://concierge-kit.dev/reference/create-relay
 */
export interface Relay<O extends RelayOptions = RelayOptions> {
  /** The options this relay was built with, resolved lazily by each call. */
  readonly options: O;
  /**
   * Relays the upstream `Set-Cookie` headers onto a response for the browser.
   * @see https://concierge-kit.dev/reference/cookie#relaysetcookies
   */
  relayCookies(
    from: Response | Headers,
    to: Headers,
    ctx?: RelayContext,
  ): RelayResult<RelayCookieNames<O>>;
  /**
   * Builds the `RequestInit` for a backend call with the browser's allowed cookies attached.
   * @see https://concierge-kit.dev/reference/cookie#forwardrequestcookies
   */
  forwardCookies(from: Request | Headers, init?: RequestInit): RequestInit;
  /**
   * Builds the `RequestInit` for a backend call, applying every configured forward rule:
   * cookies, and what is left of the request's time budget.
   * @see https://concierge-kit.dev/reference/forward
   */
  forwardRequest(from: Request | Headers, init?: RequestInit): RequestInit;
  /**
   * What is left of this request's time budget, or `undefined` when none was stamped.
   * @see https://concierge-kit.dev/reference/deadline
   */
  deadlineOf(from: Request | Headers): DeadlineView | undefined;
  /**
   * The upstream response headers that are safe to copy to the browser.
   * @see https://concierge-kit.dev/reference/headers#prepareresponseheaders
   */
  prepareHeaders(from: Headers): Headers;
}

/**
 * Creates a relay from one policy declaration, so call sites never repeat options.
 *
 * Outside production the policy is checked here and here only: contradictions that could
 * never produce a storable cookie throw, and settings that silently do nothing warn.
 * Production pays nothing for either.
 *
 * @example
 * ```ts
 * export const relay = createRelay({
 *   cookie: { allow: ['access_token', 'refresh_token'], domain: 'auto', secure: 'auto' },
 *   forward: { cookies: ['access_token', 'refresh_token'] },
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/create-relay
 */
export function createRelay<const O extends RelayOptions>(
  options?: StrictRelayOptions<O>,
): Relay<O> {
  const resolved = (options ?? {}) as O;
  validateRelayOptions(resolved);

  return {
    options: resolved,
    relayCookies(from, to, ctx) {
      return relaySetCookies(from, to, resolved.cookie, ctx) as RelayResult<RelayCookieNames<O>>;
    },
    forwardCookies(from, init) {
      return forwardRequestCookies(from, init, resolved.forward);
    },
    forwardRequest(from, init) {
      return forwardRequest(from, init, resolved);
    },
    deadlineOf(from) {
      if (resolved.deadline === undefined) return undefined;
      const deadline = readDeadline(from, resolved.deadline);
      return deadline === undefined ? undefined : viewDeadline(deadline);
    },
    prepareHeaders(from) {
      return prepareResponseHeaders(from);
    },
  };
}
