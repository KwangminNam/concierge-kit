/**
 * h3 and Nuxt adapter for concierge-kit.
 *
 * Every h3 API this package touches lives in one file, `framework.ts`, so the move to h3 v2
 * changes one file rather than every file.
 *
 * @see https://concierge-kit.dev/reference/h3
 */

export { createRelay, type H3Relay } from './createRelay.js';
export { applyToEvent, type ApplyOptions } from './apply.js';
export { forwardFromEvent, stampEvent } from './forward.js';
export { respondWithUpstream, type RespondOptions } from './respond.js';
export { createPassthroughRoute, type RouteOptions, type RouteTarget } from './route.js';
export { toContext, toRequest } from './framework.js';

export type {
  CookieInfo,
  CookieMatcher,
  CookieMatcherInput,
  CookieRelayPolicy,
  DeadlinePolicy,
  DeadlineView,
  DropReason,
  ForwardPolicy,
  RelayContext,
  RelayOptions,
  RelayResult,
  SetCookieInfo,
} from '@concierge-kit/core';
