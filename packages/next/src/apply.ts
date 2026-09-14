import {
  pipeSetCookies,
  type Relay,
  type RelayContext,
  type RelayResult,
  type UnappliableMode,
} from '@conciergekit/core';
import { toCookieStoreInit } from './cookieStoreInit.js';
import { readCookieStore } from './framework.js';
import { resolveContext } from './respond.js';

/** Options for {@link applyToCookieStore}. */
export interface ApplyOptions {
  /** Request information for the `'auto'` rules. Resolved from the current request when absent. */
  readonly context?: RelayContext;
  /** Overrides the relay's `onUnappliable` for this call. */
  readonly onUnappliable?: UnappliableMode;
}

/**
 * Raised when the cookie store refused a write, which in practice means it was reached during
 * a React Server Component render.
 *
 * Carries cookie names and the original error, never a cookie value.
 */
export class UnappliableCookieError extends Error {
  override readonly name = 'UnappliableCookieError';
  /** Names of the cookies that could not be written. */
  readonly cookies: readonly string[];

  constructor(message: string, cookies: readonly string[], cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.cookies = cookies;
  }
}

/**
 * Relays cookies through Next's cookie store, for a server action that has no response object.
 *
 * Prefer {@link toNextResponse} where a response is available. The cookie store is keyed by
 * name, so two cookies that share a name but differ in `Path` collapse into one, and only the
 * attributes Next models survive.
 *
 * A store that refuses the write, which is what happens during a render, is handled by the
 * `onUnappliable` policy rather than crashing the request.
 *
 * @example
 * ```ts
 * 'use server';
 * export async function login(form: FormData) {
 *   const upstream = await fetch(`${API}/login`, await relay.forward({ method: 'POST', body: form }));
 *   const result = await relay.apply(upstream);
 *   if (result.relayed.length === 0) return { error: 'LOGIN_FAILED' };
 * }
 * ```
 *
 * @see https://conciergekit.dev/guides/server-actions
 */
export async function applyToCookieStore(
  upstream: Response,
  relay: Relay,
  options?: ApplyOptions,
): Promise<RelayResult> {
  const store = await readCookieStore();
  const context = options?.context ?? (await resolveContext());
  let firstFailure: unknown;

  const result: RelayResult = pipeSetCookies(
    upstream,
    ({ raw }) => {
      const init = toCookieStoreInit(raw);
      if (init === null) return false;
      try {
        store.set(init);
        return true;
      } catch (error) {
        firstFailure ??= error;
        return false;
      }
    },
    relay.options.cookie,
    context,
  );

  const refused = result.dropped.filter((drop) => drop.reason === 'unappliable').map((d) => d.name);
  if (refused.length > 0) {
    const mode = options?.onUnappliable ?? relay.options.onUnappliable ?? 'warn';
    const message =
      `could not write ${refused.length} cookie(s): ${refused.join(', ')}. ` +
      'Next.js allows cookies().set() only in a route handler or a server action, never during ' +
      'a render. Move the call, or set the cookie from a proxy so the same request can see it.';
    if (mode === 'throw')
      throw new UnappliableCookieError(`[conciergekit] ${message}`, refused, firstFailure);
    if (mode === 'warn') (relay.options.logger ?? console).warn(`[conciergekit] ${message}`);
  }

  return result;
}
