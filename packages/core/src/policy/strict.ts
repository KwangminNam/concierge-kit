import type {
  CookieRelayPolicy,
  DeadlinePolicy,
  ForwardPolicy,
  RelayOptions,
  RequestIdPolicy,
} from './types.js';

/**
 * Makes a key that the shape does not declare an error at the call site.
 *
 * TypeScript skips excess property checking when the parameter is a generic, which
 * `createRelay` has to be to keep `allow: ['a', 'b']` as literals. Mapping every unknown key
 * to `never` puts the red squiggle back, on the misspelled key itself.
 */
export type StrictKeys<T, Shape> = T & {
  [K in keyof T]: K extends keyof Shape ? T[K] : never;
};

/**
 * {@link RelayOptions} with unknown keys rejected at compile time, one level into each policy.
 *
 * `logger` is deliberately not strict: a real logger carries many methods this package never
 * calls, and rejecting them would reject every logger worth passing.
 */
export type StrictRelayOptions<O> = O & {
  [K in keyof O]: K extends 'cookie'
    ? StrictKeys<O[K], CookieRelayPolicy>
    : K extends 'forward'
      ? StrictKeys<O[K], ForwardPolicy> & {
          [F in keyof O[K]]: F extends 'requestId' ? StrictKeys<O[K][F], RequestIdPolicy> : O[K][F];
        }
      : K extends 'deadline'
        ? StrictKeys<O[K], DeadlinePolicy>
        : K extends keyof RelayOptions
          ? O[K]
          : never;
};

/**
 * Declares relay options in a file of their own, with autocomplete, literal inference and
 * unknown-key errors, without creating the relay there.
 *
 * `satisfies RelayOptions` would widen `allow: ['a', 'b']` to `string[]`; this keeps the
 * literals, so a relay built from the result still narrows `relayed` to `('a' | 'b')[]`.
 *
 * @example
 * ```ts
 * // relay.config.ts
 * export const relayOptions = defineRelayOptions({
 *   cookie: { allow: ['access_token', 'refresh_token'], domain: 'auto' },
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/create-relay#definerelayoptions
 */
export function defineRelayOptions<const O extends RelayOptions>(
  options: StrictRelayOptions<O>,
): O {
  return options;
}
