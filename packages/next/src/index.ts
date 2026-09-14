/**
 * Next.js App Router adapter for conciergekit.
 *
 * Every Next.js API this package touches lives in one file, `framework.ts`, so a breaking
 * change in Next stays in one place and tests can replace the framework by mocking one module.
 *
 * @see https://conciergekit.dev/reference/next
 */

export { createRelay, type NextRelay } from './createRelay.js';
export { applyToCookieStore, UnappliableCookieError, type ApplyOptions } from './apply.js';
export { forwardFromRequest } from './forward.js';
export { toNextResponse, type RespondOptions } from './respond.js';
export {
  createPassthroughRoute,
  type RouteHandler,
  type RouteOptions,
  type RouteTarget,
} from './route.js';
export { withRelay, type RelayHandler, type RelayHandlerContext } from './withRelay.js';
export type { CookieStoreInit, WritableCookieStore } from './framework.js';

export type {
  CookieInfo,
  CookieMatcher,
  CookieMatcherInput,
  CookieRelayPolicy,
  DropReason,
  ForwardPolicy,
  RelayContext,
  RelayOptions,
  RelayResult,
  SetCookieInfo,
  UnappliableMode,
} from '@conciergekit/core';
