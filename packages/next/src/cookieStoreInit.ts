import { scanSetCookie, valueOf } from '@conciergekit/core';
import type { CookieStoreInit } from './framework.js';

/**
 * Turns a finished `Set-Cookie` line into the object `cookies().set()` wants.
 *
 * This is the one place conciergekit has to take a cookie apart, because Next's cookie store
 * has no way to accept a raw header. The rewriting has already happened by then, so the parse
 * is a last step rather than a round trip, and only attributes Next understands survive it.
 *
 * Attributes outside that set are lost on this path. The route handler path keeps them,
 * which is why it is the one to prefer.
 *
 * @see https://conciergekit.dev/guides/server-actions#attribute-loss
 */
export function toCookieStoreInit(raw: string): CookieStoreInit | null {
  const scanned = scanSetCookie(raw);
  if (scanned === null) return null;

  const init: CookieStoreInit = {
    name: scanned.name,
    value: raw.slice(scanned.valueStart, scanned.valueEnd),
  };

  for (const attribute of scanned.attributes) {
    const value = valueOf(raw, attribute);
    switch (attribute.key) {
      case 'domain':
        if (value !== undefined) init.domain = value;
        break;
      case 'path':
        if (value !== undefined) init.path = value;
        break;
      case 'expires': {
        const date = new Date(value ?? '');
        if (!Number.isNaN(date.getTime())) init.expires = date;
        break;
      }
      case 'max-age': {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) init.maxAge = seconds;
        break;
      }
      case 'secure':
        init.secure = true;
        break;
      case 'httponly':
        init.httpOnly = true;
        break;
      case 'partitioned':
        init.partitioned = true;
        break;
      case 'samesite': {
        const mode = value?.toLowerCase();
        if (mode === 'lax' || mode === 'strict' || mode === 'none') init.sameSite = mode;
        break;
      }
      case 'priority': {
        const level = value?.toLowerCase();
        if (level === 'low' || level === 'medium' || level === 'high') init.priority = level;
        break;
      }
      default:
        break;
    }
  }

  return init;
}
