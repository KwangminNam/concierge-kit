/**
 * concierge-kit core. Web standards only, no framework imports, no Node built-ins.
 *
 * Everything here works unchanged in a Next.js route handler, a SvelteKit endpoint, a Hono
 * handler or a plain script, because the only types it knows are `Request`, `Response`,
 * `Headers` and `RequestInit`.
 *
 * @see https://concierge-kit.dev
 */

export { createRelay, type Relay, type RelayCookieNames } from './createRelay.js';
export { forwardRequest, type ForwardRules } from './forwardRequest.js';
export { defineRelayOptions, type StrictKeys, type StrictRelayOptions } from './policy/strict.js';
export {
  DEADLINE_DEFAULTS,
  deadlineSignal,
  forwardDeadline,
  readDeadline,
  remainingMs,
  stampDeadline,
  viewDeadline,
  type Deadline,
  type DeadlineView,
} from './deadline/deadline.js';
export { domainMatches, normalizeHost, resolveRelayContext, type RelayContext } from './context.js';

export { forwardRequestCookies, parseCookieHeader } from './cookie/forwardRequestCookies.js';
export { literalCookieNames, matchCookie } from './cookie/matchCookie.js';
export {
  pipeSetCookies,
  relaySetCookies,
  type OutgoingSetCookie,
} from './cookie/relaySetCookies.js';
export { mergeIntoCookieHeader, removeFromCookieHeader } from './cookie/mergeIntoCookieHeader.js';
export { rewriteSetCookie } from './cookie/rewriteSetCookie.js';
export {
  findAttribute,
  scanSetCookie,
  toSetCookieInfo,
  valueOf,
  type CookieSegment,
  type ScannedSetCookie,
} from './cookie/scanSetCookie.js';
export { splitSetCookie, splitSetCookieString } from './cookie/splitSetCookie.js';

export {
  HOP_BY_HOP_HEADERS,
  prepareResponseHeaders,
  stripHopByHopHeaders,
} from './headers/hopByHop.js';
export {
  NEVER_FORWARDED_HEADERS,
  ensureRequestId,
  forwardRequestHeaders,
  forwardRequestId,
} from './headers/forwardRequestHeaders.js';

export {
  COOKIE_RULE_DEFAULTS,
  resolveCookieRules,
  type ResolvedCookieRules,
} from './policy/defaults.js';
export { validateRelayOptions } from './policy/validate.js';
export type {
  CookieInfo,
  CookieMatcher,
  CookieMatcherInput,
  CookieRelayPolicy,
  DeadlinePolicy,
  DomainRule,
  DropReason,
  ForwardPolicy,
  HeaderInfo,
  HeaderMatcherInput,
  NamesOf,
  PathRule,
  RelayLogger,
  RelayOptions,
  RelayResult,
  RelayedNames,
  RenameRules,
  RequestIdPolicy,
  SameSiteRule,
  SecureRule,
  SetCookieInfo,
  UnappliableMode,
} from './policy/types.js';
