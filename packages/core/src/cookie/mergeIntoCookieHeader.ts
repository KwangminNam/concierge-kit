import { parseCookieHeader } from './forwardRequestCookies.js';
import { findAttribute, scanSetCookie, valueOf, type ScannedSetCookie } from './scanSetCookie.js';

/**
 * Folds outgoing `Set-Cookie` lines into a `Cookie` request header.
 *
 * This is what lets one request see a cookie the browser has not stored yet. A proxy that
 * rotates a token writes `Set-Cookie` for the browser, but the render that follows in the same
 * request still reads the old `Cookie` header unless that header is rewritten too. Doing only
 * one of the two fails silently, in opposite directions.
 *
 * A cookie being deleted, by `Max-Age=0` or an `Expires` in the past, is removed rather than set.
 *
 * Cookie values pass through here and nowhere else. They are read from the raw line and written
 * straight into the header, so they never reach a return value, a log or user code.
 *
 * @see https://concierge-kit.dev/reference/cookie#mergeintocookieheader
 */
export function mergeIntoCookieHeader(
  cookieHeader: string | null,
  setCookies: readonly string[],
  now: number = Date.now(),
): string {
  const jar = new Map<string, string>();
  for (const cookie of parseCookieHeader(cookieHeader)) jar.set(cookie.name, cookie.value);

  for (const raw of setCookies) {
    const scanned = scanSetCookie(raw);
    if (scanned === null) continue;
    if (isDeletion(scanned, now)) jar.delete(scanned.name);
    else jar.set(scanned.name, raw.slice(scanned.valueStart, scanned.valueEnd));
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/**
 * Removes named cookies from a `Cookie` request header, for the case where a session has ended
 * and the request in flight should already look logged out.
 */
export function removeFromCookieHeader(
  cookieHeader: string | null,
  names: readonly string[],
): string {
  const drop = new Set(names);
  return parseCookieHeader(cookieHeader)
    .filter((cookie) => !drop.has(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function isDeletion(scanned: ScannedSetCookie, now: number): boolean {
  const maxAge = findAttribute(scanned, 'max-age');
  if (maxAge !== undefined) {
    const seconds = Number(valueOf(scanned.raw, maxAge));
    if (Number.isFinite(seconds)) return seconds <= 0;
  }
  const expires = findAttribute(scanned, 'expires');
  if (expires !== undefined) {
    const at = new Date(valueOf(scanned.raw, expires) ?? '').getTime();
    if (!Number.isNaN(at)) return at <= now;
  }
  return false;
}
