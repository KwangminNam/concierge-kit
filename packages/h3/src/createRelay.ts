import {
  createRelay as createCoreRelay,
  type DeadlineView,
  type Relay,
  type RelayCookieNames,
  type RelayOptions,
  type RelayResult,
  type StrictRelayOptions,
} from '@concierge-kit/core';
import type { EventHandler, H3Event } from 'h3';
import { applyToEvent, type ApplyOptions } from './apply.js';
import { forwardFromEvent, stampEvent } from './forward.js';
import { stampedRequestHeaders } from './framework.js';
import { createRefreshMiddleware, type RefreshOptions } from './proxy.js';
import { respondWithUpstream, type RespondOptions } from './respond.js';
import { createPassthroughRoute, type RouteOptions, type RouteTarget } from './route.js';

/**
 * A relay that also knows h3, which is what Nuxt runs its server routes on.
 *
 * Every method is synchronous except the one that sends a response, because h3 hands you the
 * request directly rather than through an async accessor.
 *
 * @see https://concierge-kit.dev/reference/h3
 */
export interface H3Relay<O extends RelayOptions = RelayOptions> extends Relay<O> {
  /** The `RequestInit` for a backend call, with the browser's allowed cookies attached. */
  forward(event: H3Event, init?: RequestInit): RequestInit;
  /** Relays cookies onto the response being built, leaving status and body to you. */
  apply(
    event: H3Event,
    upstream: Response | Headers,
    options?: ApplyOptions,
  ): RelayResult<RelayCookieNames<O>>;
  /** Sends the backend response through as it arrived, cookies relayed. */
  respond(event: H3Event, upstream: Response, options?: RespondOptions): Promise<void>;
  /** Builds a passthrough event handler for this target. */
  route(target: RouteTarget, options?: RouteOptions): EventHandler;
  /** What is left of this request's time budget, or `undefined` when no deadline is configured. */
  deadline(event: H3Event): DeadlineView | undefined;
  /** Starts the budget now, for an `onRequest` hook. */
  stamp(event: H3Event): void;
  /**
   * Builds a middleware that refreshes a session and hands the result to the request that
   * needed it. The only place a cookie can reach the handlers running right after.
   */
  refresh(options: RefreshOptions): EventHandler;
}

/**
 * Declares the relay policy for an application once, and hands back a relay that knows h3.
 *
 * Call this in one module and import the result everywhere, so no call site repeats a policy.
 * Outside production the policy is validated here: a combination that could never produce a
 * storable cookie throws, and one that silently does nothing warns.
 *
 * `onUnappliable` is accepted and ignored. It describes a React Server Component restriction,
 * and an h3 handler can always write a response header.
 *
 * @example
 * ```ts
 * // server/utils/relay.ts
 * import { createRelay } from '@concierge-kit/h3';
 *
 * export const relay = createRelay({
 *   cookie: { allow: ['access_token', 'refresh_token'], domain: 'auto', secure: 'auto' },
 *   forward: { cookies: ['access_token', 'refresh_token'] },
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/h3#createrelay
 */
export function createRelay<const O extends RelayOptions>(
  options?: StrictRelayOptions<O>,
): H3Relay<O> {
  const core = createCoreRelay(options);

  return {
    ...core,
    forward: (event, init) => forwardFromEvent(core, event, init),
    apply: (event, upstream, applyOptions) =>
      applyToEvent(core, event, upstream, applyOptions) as RelayResult<RelayCookieNames<O>>,
    respond: (event, upstream, respondOptions) =>
      respondWithUpstream(core, event, upstream, respondOptions),
    route: (target, routeOptions) => createPassthroughRoute(core, target, routeOptions),
    deadline: (event) =>
      core.options.deadline === undefined
        ? undefined
        : core.deadlineOf(stampedRequestHeaders(event, core.options.deadline)),
    stamp: (event) => stampEvent(core, event),
    refresh: (refreshOptions) => createRefreshMiddleware(core, refreshOptions),
  };
}
