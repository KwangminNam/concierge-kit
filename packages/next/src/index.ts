/**
 * Next.js App Router adapter for concierge-kit.
 *
 * Every Next.js API this package touches lives in one file, `framework.ts`, so a breaking
 * change in Next stays in one place and tests can replace the framework by mocking one module.
 *
 * @see https://concierge-kit.dev/reference/next
 */

export { createRelay, type NextRelay } from './createRelay.js';
export { applyToCookieStore, UnappliableCookieError, type ApplyOptions } from './apply.js';
export { forwardFromRequest } from './forward.js';
export {
  clearSession,
  createProxy,
  rotateFromUpstream,
  stampRequest,
  type ProxyOptions,
  type RotateOptions,
  type RotateResult,
} from './proxy.js';
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
  DeadlinePolicy,
  DeadlineView,
  DropReason,
  ForwardPolicy,
  RelayContext,
  RelayOptions,
  RelayResult,
  SetCookieInfo,
  UnappliableMode,
} from '@concierge-kit/core';
