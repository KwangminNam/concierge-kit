/**
 * Reads every `Set-Cookie` line out of a `Headers` object as separate raw strings.
 *
 * `headers.get('set-cookie')` must never be used for this: it joins multiple cookies with
 * `", "`, which is indistinguishable from the comma inside `Expires=Wed, 21 Oct 2025 ...`.
 * `Headers.getSetCookie()` is used whenever the runtime has it, which is every supported
 * Node version and every modern browser-standard implementation.
 *
 * @see https://conciergekit.dev/reference/cookie#splitsetcookie
 */
export function splitSetCookie(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const joined = headers.get('set-cookie');
  return joined === null ? [] : splitSetCookieString(joined);
}

/**
 * Splits a comma-joined `Set-Cookie` string back into individual cookies.
 *
 * Only reached on runtimes whose `Headers` predates `getSetCookie()`, typically a polyfill.
 * A comma starts a new cookie only when the text that follows looks like `name=`, which is
 * what separates a real boundary from the comma inside an `Expires` date.
 *
 * @see https://conciergekit.dev/reference/cookie#splitsetcookiestring
 */
export function splitSetCookieString(input: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch !== ',' || inQuotes) continue;
    if (!startsNewCookie(input, i + 1)) continue;

    const piece = input.slice(start, i).trim();
    if (piece !== '') out.push(piece);
    start = i + 1;
  }

  const last = input.slice(start).trim();
  if (last !== '') out.push(last);
  return out;
}

/**
 * Looks ahead from just after a comma. A new cookie starts when the next thing is a
 * non-empty token followed by `=`, before any `;` or `,` appears.
 */
function startsNewCookie(input: string, from: number): boolean {
  let i = from;
  while (i < input.length && (input.charAt(i) === ' ' || input.charAt(i) === '\t')) i++;
  const tokenStart = i;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '=') return i > tokenStart;
    if (ch === ';' || ch === ',' || ch === ' ') return false;
    i++;
  }
  return false;
}
