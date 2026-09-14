import type { CookieInfo, CookieMatcher, CookieMatcherInput } from '../policy/types.js';

/**
 * Decides whether a cookie satisfies an allow condition.
 *
 * Accepts every matcher shape, and an array of them combined with OR, so a policy can mix a
 * literal name, a pattern and a predicate without the caller normalising anything.
 *
 * A predicate receives the cookie identity without its value, which is what keeps cookie
 * values out of user code by construction.
 *
 * @see https://concierge-kit.dev/reference/cookie#matchcookie
 */
export function matchCookie<I extends CookieInfo>(
  cookie: I,
  matcher: CookieMatcherInput<I> | undefined,
): boolean {
  if (matcher === undefined) return false;
  if (Array.isArray(matcher)) {
    return (matcher as ReadonlyArray<CookieMatcher<I>>).some((one) => matchOne(cookie, one));
  }
  return matchOne(cookie, matcher as CookieMatcher<I>);
}

function matchOne<I extends CookieInfo>(cookie: I, matcher: CookieMatcher<I>): boolean {
  if (typeof matcher === 'boolean') return matcher;
  if (typeof matcher === 'string') return cookie.name === matcher;
  if (typeof matcher === 'function') return matcher(cookie) === true;
  if (matcher instanceof RegExp) {
    // A global or sticky pattern carries lastIndex between calls, which would make the same
    // cookie match on one request and not the next.
    if (matcher.global || matcher.sticky) matcher.lastIndex = 0;
    return matcher.test(cookie.name);
  }
  return false;
}

/**
 * The cookie names a matcher names outright.
 *
 * A pattern or a predicate names nothing, so it contributes nothing here. Used where a concrete
 * list is unavoidable, such as clearing a session: you cannot clear a `RegExp`.
 *
 * @see https://concierge-kit.dev/reference/cookie#literalcookienames
 */
export function literalCookieNames<I extends CookieInfo>(
  matcher: CookieMatcherInput<I> | undefined,
): string[] {
  if (matcher === undefined) return [];
  const list = Array.isArray(matcher) ? matcher : [matcher];
  return (list as ReadonlyArray<CookieMatcher<I>>).filter(
    (one): one is string => typeof one === 'string',
  );
}
