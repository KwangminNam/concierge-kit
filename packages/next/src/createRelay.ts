import {
  createRelay as createCoreRelay,
  type Relay,
  type RelayCookieNames,
  type RelayOptions,
  type RelayResult,
} from '@concierge-kit/core';
import { applyToCookieStore, type ApplyOptions } from './apply.js';
import { forwardFromRequest } from './forward.js';
import {
  createPassthroughRoute,
  type RouteHandler,
  type RouteOptions,
  type RouteTarget,
} from './route.js';
import { toNextResponse, type RespondOptions } from './respond.js';

/**
 * A relay that also knows Next.js.
 *
 * Every method here is asynchronous, because reading the current request in Next is
 * asynchronous. The inherited core methods stay synchronous and work anywhere.
 *
 * @see https://concierge-kit.dev/reference/next
 */
export interface NextRelay<O extends RelayOptions = RelayOptions> extends Relay<O> {
  /**
   * The `RequestInit` for a backend call, with the browser's allowed cookies attached.
   * Omit the request inside a server action, where there is none to pass.
   */
  forward(request?: Request, init?: RequestInit): Promise<RequestInit>;
  /** Returns a backend response to the browser with its allowed cookies. */
  respond(upstream: Response, options?: RespondOptions): Promise<Response>;
  /** Writes the allowed cookies through Next's cookie store, for server actions. */
  apply(upstream: Response, options?: ApplyOptions): Promise<RelayResult<RelayCookieNames<O>>>;
  /** Builds a passthrough route handler for this target. */
  route(target: RouteTarget, options?: RouteOptions): RouteHandler;
}

/**
 * Declares the relay policy for an application once, and hands back a relay that knows Next.
 *
 * Call this in one module and import the result everywhere, so no call site repeats a policy.
 * Outside production the policy is validated here: a combination that could never produce a
 * storable cookie throws, and one that silently does nothing warns.
 *
 * @example
 * ```ts
 * // lib/relay.ts
 * import { createRelay } from '@concierge-kit/next';
 *
 * export const relay = createRelay({
 *   cookie: { allow: ['access_token', 'refresh_token'], domain: 'auto', secure: 'auto' },
 *   forward: { cookies: ['access_token', 'refresh_token'] },
 *   onUnappliable: 'warn',
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/next#createrelay
 */
export function createRelay<const O extends RelayOptions>(options?: O): NextRelay<O> {
  const core = createCoreRelay(options);

  return {
    ...core,
    forward: (request, init) => forwardFromRequest(core, request, init),
    respond: (upstream, respondOptions) => toNextResponse(upstream, core, respondOptions),
    apply: (upstream, applyOptions) =>
      applyToCookieStore(upstream, core, applyOptions) as Promise<RelayResult<RelayCookieNames<O>>>,
    route: (target, routeOptions) => createPassthroughRoute(core, target, routeOptions),
  };
}
