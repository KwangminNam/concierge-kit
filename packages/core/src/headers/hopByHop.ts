/**
 * Headers that describe one network hop and must not be copied onto the next one.
 *
 * `content-encoding` and `content-length` are the two that matter in practice: `fetch`
 * decompresses the upstream body but leaves both headers saying it is still compressed, so
 * copying them makes the browser fail with a content decoding error.
 *
 * @see https://concierge-kit.dev/reference/headers#hop-by-hop
 */
export const HOP_BY_HOP_HEADERS: readonly string[] = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/**
 * Copies headers, leaving out the ones that belong to the upstream hop.
 *
 * @see https://concierge-kit.dev/reference/headers#striphopbyhopheaders
 */
export function stripHopByHopHeaders(from: Headers): Headers {
  const out = new Headers(from);
  for (const name of HOP_BY_HOP_HEADERS) out.delete(name);
  return out;
}

/**
 * The upstream response headers that are safe to send to the browser as they are.
 *
 * Drops the hop-by-hop headers and, crucially, every `Set-Cookie`. Cookies are relayed
 * separately through the allow policy, so copying them here would hand the browser every
 * internal cookie the backend happened to set.
 *
 * @see https://concierge-kit.dev/reference/headers#prepareresponseheaders
 */
export function prepareResponseHeaders(from: Headers): Headers {
  const out = stripHopByHopHeaders(from);
  out.delete('set-cookie');
  return out;
}
