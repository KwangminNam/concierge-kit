import { devWarnOnce, isDev } from '../internal/dev.js';
import type { RelayOptions } from './types.js';

/**
 * Development-only sanity check for a policy, run once when {@link createRelay} is called.
 *
 * Statically impossible combinations throw, because they can only ever produce a cookie the
 * browser discards without an error, which is the hardest kind of bug to find. Combinations
 * that merely do nothing warn.
 *
 * Does nothing in production.
 *
 * @see https://concierge-kit.dev/reference/create-relay#validation
 */
export function validateRelayOptions(
  options: RelayOptions,
  extraTopLevelKeys: readonly string[] = [],
): void {
  if (!isDev()) return;

  assertKnownKeys('createRelay options', options, [...TOP_LEVEL_KEYS, ...extraTopLevelKeys]);
  if (options.cookie !== undefined) assertKnownKeys('cookie policy', options.cookie, COOKIE_KEYS);
  if (options.forward !== undefined)
    assertKnownKeys('forward policy', options.forward, FORWARD_KEYS);

  const cookie = options.cookie;
  const logger = options.logger;

  if (cookie === undefined) {
    devWarnOnce(
      logger,
      'no-cookie-policy',
      'createRelay() was called without a cookie policy, so no upstream cookie will ever reach ' +
        'the browser. Pass cookie.allow to relay something.',
    );
  } else {
    if (cookie.sameSite === 'none' && cookie.secure === 'strip') {
      throw new Error(
        '[concierge-kit] cookie.sameSite "none" with cookie.secure "strip" can never be stored: ' +
          'SameSite=None requires Secure. Use sameSite "auto" to downgrade to Lax instead.',
      );
    }
    if (cookie.sameSite === 'none' && cookie.secure === 'auto') {
      devWarnOnce(
        logger,
        'samesite-none-secure-auto',
        'cookie.sameSite "none" with cookie.secure "auto" is rejected by browsers over plain ' +
          'http, because SameSite=None requires Secure. Consider sameSite "auto".',
      );
    }
    if (isEmptyMatcher(cookie.allow)) {
      devWarnOnce(
        logger,
        'empty-allow',
        'cookie.allow is empty, so no upstream cookie will reach the browser.',
      );
    }
  }

  if (options.forward !== undefined && isEmptyMatcher(options.forward.cookies)) {
    devWarnOnce(
      logger,
      'empty-forward',
      'forward.cookies is empty, so no browser cookie will reach the backend.',
    );
  }

  if (cookie?.legacyNames?.length || options.forward?.legacyNames?.length) {
    devWarnOnce(
      logger,
      'legacy-names',
      'legacyNames is reserved and has no effect in this release.',
    );
  }
}

const TOP_LEVEL_KEYS = ['cookie', 'forward', 'onUnappliable', 'logger'] as const;
const COOKIE_KEYS = [
  'allow',
  'domain',
  'secure',
  'sameSite',
  'path',
  'rename',
  'legacyNames',
] as const;
const FORWARD_KEYS = ['cookies', 'rename', 'legacyNames'] as const;

/**
 * A key nobody reads is a key that silently does nothing, which is the failure mode this
 * package exists to remove. TypeScript cannot catch it here, because excess property checking
 * does not apply to a generic parameter, so it is caught at startup in development instead.
 */
function assertKnownKeys(what: string, value: object, known: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  if (unknown.length === 0) return;
  throw new Error(
    `[concierge-kit] unknown ${what} key: ${unknown.join(', ')}. ` +
      `Known keys are ${known.join(', ')}.`,
  );
}

function isEmptyMatcher(matcher: unknown): boolean {
  if (matcher === undefined || matcher === false) return true;
  return Array.isArray(matcher) && matcher.length === 0;
}
