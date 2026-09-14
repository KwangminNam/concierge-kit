/**
 * Policy types. This file is the single source of truth for every configuration key
 * and default of conciergekit. Documentation is generated from here, never the other way round.
 *
 * @see https://conciergekit.dev/reference/policy
 */

/**
 * Minimal identity of a cookie. Deliberately carries **no value**: cookie values must never
 * reach a matcher callback, a log line, an error message or a test snapshot.
 *
 * @see https://conciergekit.dev/reference/policy#cookieinfo
 */
export interface CookieInfo {
  /** Cookie name, exactly as it appeared on the wire. */
  readonly name: string;
}

/**
 * Everything conciergekit knows about an upstream `Set-Cookie` line, minus the value.
 *
 * @see https://conciergekit.dev/reference/policy#setcookieinfo
 */
export interface SetCookieInfo extends CookieInfo {
  /** `Domain` attribute as written upstream, including any leading dot. */
  readonly domain?: string;
  /** `Path` attribute as written upstream. */
  readonly path?: string;
  /** Whether the `Secure` attribute is present. */
  readonly secure: boolean;
  /** Whether the `HttpOnly` attribute is present. */
  readonly httpOnly: boolean;
  /** `SameSite` attribute, lowercased, when it is one of the three legal values. */
  readonly sameSite?: 'strict' | 'lax' | 'none';
  /** Lowercased names of every attribute present, including ones conciergekit never rewrites. */
  readonly attributes: readonly string[];
}

/**
 * One allow condition. A plain string matches a cookie name exactly, a `RegExp` is tested
 * against the name, and a predicate receives the cookie identity without its value.
 *
 * @see https://conciergekit.dev/reference/policy#matchers
 */
export type CookieMatcher<I extends CookieInfo = SetCookieInfo> =
  boolean | string | RegExp | ((cookie: I) => boolean);

/** One matcher, or an array of matchers combined with OR. */
export type CookieMatcherInput<I extends CookieInfo = SetCookieInfo> =
  CookieMatcher<I> | ReadonlyArray<CookieMatcher<I>>;

/**
 * Extracts the literal cookie names a matcher can produce, so `allow: ['a', 'b']` narrows
 * `RelayResult['relayed']` to `('a' | 'b')[]`. Any non-literal matcher widens it to `string`.
 */
export type NamesOf<A> = A extends readonly unknown[]
  ? NamesOf<A[number]>
  : A extends string
    ? A
    : string;

/**
 * What to do with the `Domain` attribute.
 *
 * - `'keep'` leaves it untouched.
 * - `'strip'` removes it, turning the cookie into a host-only cookie.
 * - `'auto'` (default) removes it only when the current request host cannot match it,
 *   which is the case that makes a browser reject the cookie silently.
 * - A function receives the upstream domain and returns a replacement, `null` to strip,
 *   or `undefined` to keep.
 */
export type DomainRule =
  'keep' | 'strip' | 'auto' | ((domain: string | undefined) => string | null | undefined);

/**
 * What to do with the `Secure` attribute.
 *
 * - `'keep'` leaves it untouched.
 * - `'strip'` always removes it.
 * - `'force'` always adds it.
 * - `'auto'` (default) removes it only when the incoming request is plain http, where a
 *   `Secure` cookie would be rejected. Requires a {@link RelayContext}.
 */
export type SecureRule = 'keep' | 'strip' | 'force' | 'auto';

/**
 * What to do with the `SameSite` attribute.
 *
 * - `'keep'` leaves it untouched.
 * - `'auto'` (default) downgrades `None` to `Lax` when the cookie ends up without `Secure`,
 *   because `SameSite=None` without `Secure` is rejected.
 * - An explicit value overwrites whatever upstream sent.
 */
export type SameSiteRule = 'keep' | 'auto' | 'lax' | 'strict' | 'none';

/** `'keep'` leaves `Path` untouched, any other string overwrites it. */
export type PathRule = 'keep' | (string & {});

/** Renaming hooks. Both directions are needed: a renamed cookie has to travel back. */
export interface RenameRules {
  /** Applied to upstream cookie names on their way to the browser. */
  readonly toBrowser?: (name: string) => string;
  /** Applied to browser cookie names on their way to the backend. */
  readonly toUpstream?: (name: string) => string;
}

/**
 * How upstream `Set-Cookie` headers are relayed to the browser.
 *
 * `allow` has no default: with no policy at all nothing is relayed and development builds warn.
 *
 * @see https://conciergekit.dev/reference/policy#cookierelaypolicy
 */
export interface CookieRelayPolicy<
  A extends CookieMatcherInput<SetCookieInfo> = CookieMatcherInput<SetCookieInfo>,
> {
  /** Which upstream cookies may reach the browser. Required, and never defaulted to `true`. */
  readonly allow: A;
  /** @defaultValue `'auto'` */
  readonly domain?: DomainRule;
  /** @defaultValue `'auto'` */
  readonly secure?: SecureRule;
  /** @defaultValue `'auto'` */
  readonly sameSite?: SameSiteRule;
  /** @defaultValue `'keep'` */
  readonly path?: PathRule;
  /** @see {@link RenameRules} */
  readonly rename?: RenameRules;
  /**
   * Old names kept readable during a rename transition. Reserved for a future release:
   * declaring it today is accepted and has no effect yet.
   */
  readonly legacyNames?: readonly string[];
}

/**
 * How browser request cookies are forwarded to the backend.
 *
 * @see https://conciergekit.dev/reference/policy#forwardpolicy
 */
export interface ForwardPolicy<
  C extends CookieMatcherInput<CookieInfo> = CookieMatcherInput<CookieInfo>,
> {
  /** Which browser cookies may reach the backend. Omitted means none. */
  readonly cookies?: C;
  /** @see {@link RenameRules} */
  readonly rename?: RenameRules;
  /** Reserved, same contract as {@link CookieRelayPolicy.legacyNames}. */
  readonly legacyNames?: readonly string[];
}

/**
 * What to do when the adapter cannot write a cookie at all, which in Next.js means
 * `cookies().set()` was reached during a React Server Component render.
 *
 * Only the Next.js adapter reads this. Other adapters ignore it, because the restriction
 * is specific to React Server Components.
 *
 * @defaultValue `'warn'`
 */
export type UnappliableMode = 'warn' | 'throw' | 'ignore';

/** Why a cookie was not relayed. Carries a name, never a value. */
export type DropReason =
  /** The `allow` matcher rejected it. */
  | 'not-allowed'
  /** The header could not be read as a cookie at all. */
  | 'malformed'
  /** The adapter had no writable surface, for example an RSC render. */
  | 'unappliable';

/**
 * What a relay call did. Names only: values never appear here, by design.
 *
 * @see https://conciergekit.dev/reference/policy#relayresult
 */
export interface RelayResult<N extends string = string> {
  /** Names of the cookies written to the destination, after any rename. */
  readonly relayed: N[];
  /** Names that were not written, each with the reason. */
  readonly dropped: ReadonlyArray<{ readonly name: string; readonly reason: DropReason }>;
}

/** Anywhere conciergekit reports what it did. Receives names and reasons, never values. */
export interface RelayLogger {
  warn(message: string): void;
}

/**
 * Options for {@link createRelay}.
 *
 * @see https://conciergekit.dev/reference/create-relay
 */
export interface RelayOptions<
  A extends CookieMatcherInput<SetCookieInfo> = CookieMatcherInput<SetCookieInfo>,
  C extends CookieMatcherInput<CookieInfo> = CookieMatcherInput<CookieInfo>,
> {
  /** Backend to browser. */
  readonly cookie?: CookieRelayPolicy<A>;
  /** Browser to backend. */
  readonly forward?: ForwardPolicy<C>;
  /** @defaultValue `'warn'` */
  readonly onUnappliable?: UnappliableMode;
  /** @defaultValue the global `console` */
  readonly logger?: RelayLogger;
}

/**
 * The cookie names a relay call can report as relayed.
 *
 * Narrows to the literals in `allow`, and widens back to `string` when a `rename.toBrowser`
 * hook is configured, because the emitted name is then whatever that hook returns.
 */
export type RelayedNames<P> = P extends { rename: { toBrowser: (name: string) => string } }
  ? string
  : NamesOf<P extends { allow: infer A } ? A : never>;
