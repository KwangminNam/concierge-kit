import type { RelayContext } from '../context.js';
import { headersOfResponse } from '../internal/toHeaders.js';
import { devWarnOnce } from '../internal/dev.js';
import { resolveCookieRules } from '../policy/defaults.js';
import type { CookieRelayPolicy, DropReason, RelayResult, RelayedNames } from '../policy/types.js';
import { matchCookie } from './matchCookie.js';
import { rewriteSetCookie } from './rewriteSetCookie.js';
import { scanSetCookie, toSetCookieInfo } from './scanSetCookie.js';
import { splitSetCookie } from './splitSetCookie.js';

/**
 * One cookie on its way out, after the allow check and after rewriting.
 *
 * The raw string is handed to a sink rather than returned, so a cookie value only ever exists
 * inside the destination an adapter writes to.
 */
export interface OutgoingSetCookie {
  /** The full `Set-Cookie` line to write. */
  readonly raw: string;
  /** The cookie name, after any rename. */
  readonly name: string;
}

/**
 * The shared engine behind every relay path: split, match, rewrite, hand to a sink.
 *
 * A sink returning `false` reports that the destination could not take the cookie, which is
 * how the Next.js adapter turns a render-time cookie store into a `'unappliable'` drop
 * instead of a crash.
 *
 * @see https://conciergekit.dev/reference/cookie#pipesetcookies
 */
export function pipeSetCookies<const P extends CookieRelayPolicy>(
  from: Response | Headers,
  sink: (cookie: OutgoingSetCookie) => boolean | void,
  policy?: P,
  ctx?: RelayContext,
): RelayResult<RelayedNames<P>> {
  const headers = headersOfResponse(from);
  const rules = resolveCookieRules(policy);
  const relayed: string[] = [];
  const dropped: Array<{ name: string; reason: DropReason }> = [];

  if (policy === undefined) {
    devWarnOnce(
      undefined,
      'relay-without-policy',
      'A relay ran without a cookie policy, so nothing was relayed. ' +
        'Pass { allow: [...] } to relay something.',
    );
  }

  for (const raw of splitSetCookie(headers)) {
    const scanned = scanSetCookie(raw);
    if (scanned === null) {
      dropped.push({ name: '', reason: 'malformed' });
      continue;
    }
    const info = toSetCookieInfo(scanned);
    if (!matchCookie(info, policy?.allow)) {
      dropped.push({ name: info.name, reason: 'not-allowed' });
      continue;
    }
    const name = rules.renameToBrowser?.(info.name) ?? info.name;
    const accepted = sink({ raw: rewriteSetCookie(scanned, info, rules, ctx), name });
    if (accepted === false) dropped.push({ name, reason: 'unappliable' });
    else relayed.push(name);
  }

  return { relayed, dropped } as unknown as RelayResult<RelayedNames<P>>;
}

/**
 * Relays the `Set-Cookie` headers of a backend response onto a response headed for the browser.
 *
 * Each cookie is checked against `policy.allow`, rewritten by splicing its original string,
 * and appended. Appending rather than setting is what keeps two cookies that share a name but
 * differ in `Path` or `Domain` from overwriting each other.
 *
 * With no policy nothing is relayed, and development builds say so once.
 *
 * @example
 * ```ts
 * const upstream = await fetch(`${API}/login`, { method: 'POST', body });
 * const response = new Response(upstream.body, { status: upstream.status });
 * relaySetCookies(upstream, response.headers, { allow: ['access_token'] }, ctx);
 * ```
 *
 * @returns Which cookie names were relayed and which were dropped, with reasons. Never values.
 * @see https://conciergekit.dev/reference/cookie#relaysetcookies
 */
export function relaySetCookies<const P extends CookieRelayPolicy>(
  from: Response | Headers,
  to: Headers,
  policy?: P,
  ctx?: RelayContext,
): RelayResult<RelayedNames<P>> {
  return pipeSetCookies(from, ({ raw }) => void to.append('set-cookie', raw), policy, ctx);
}
