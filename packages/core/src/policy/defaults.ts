import type { CookieRelayPolicy, DomainRule, PathRule, SameSiteRule, SecureRule } from './types.js';

/**
 * Resolved rules, with every optional key filled in. `allow` is not here: there is no safe
 * default for it, so its absence is reported rather than guessed.
 */
export interface ResolvedCookieRules {
  readonly domain: DomainRule;
  readonly secure: SecureRule;
  readonly sameSite: SameSiteRule;
  readonly path: PathRule;
  readonly renameToBrowser?: (name: string) => string;
}

/**
 * Defaults chosen so that an unconfigured relay is safe rather than convenient.
 *
 * `domain`, `secure` and `sameSite` all default to `'auto'`, which only ever removes an
 * attribute that would have made the browser reject the cookie without an error.
 */
export const COOKIE_RULE_DEFAULTS = {
  domain: 'auto',
  secure: 'auto',
  sameSite: 'auto',
  path: 'keep',
} as const satisfies Omit<ResolvedCookieRules, 'renameToBrowser'>;

export function resolveCookieRules(policy?: CookieRelayPolicy): ResolvedCookieRules {
  return {
    domain: policy?.domain ?? COOKIE_RULE_DEFAULTS.domain,
    secure: policy?.secure ?? COOKIE_RULE_DEFAULTS.secure,
    sameSite: policy?.sameSite ?? COOKIE_RULE_DEFAULTS.sameSite,
    path: policy?.path ?? COOKIE_RULE_DEFAULTS.path,
    ...(policy?.rename?.toBrowser ? { renameToBrowser: policy.rename.toBrowser } : {}),
  };
}
