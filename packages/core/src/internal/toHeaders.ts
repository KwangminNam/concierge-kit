/**
 * Narrows a request or response to its headers.
 *
 * Written as a positive test for something only a `Request` or a `Response` has, never as a
 * test for a `headers` property. Next's `headers()` returns a wrapper that exposes a `headers`
 * field of its own, so asking "does it have headers" mistakes a headers object for a request
 * and reaches for a field that is not the one you wanted.
 */
export function headersOfRequest(from: Request | Headers): Headers {
  return typeof (from as Request).url === 'string' ? (from as Request).headers : (from as Headers);
}

export function headersOfResponse(from: Response | Headers): Headers {
  return typeof (from as Response).status === 'number'
    ? (from as Response).headers
    : (from as Headers);
}
