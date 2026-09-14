import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * The one and only place in this package that touches a Next.js API.
 *
 * Everything else works against these four functions, so a breaking change in Next lands in
 * this file and nowhere else, and a test can replace the whole framework by mocking one module.
 *
 * @see https://conciergekit.dev/reference/next#framework
 */

/** The subset of Next's cookie store conciergekit writes to. */
export interface WritableCookieStore {
  set(options: CookieStoreInit): unknown;
}

/** The shape Next's `cookies().set()` accepts. */
export interface CookieStoreInit {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  priority?: 'low' | 'medium' | 'high';
  partitioned?: boolean;
}

/** The incoming request headers, for call sites that never receive a `Request`. */
export async function readRequestHeaders(): Promise<Headers> {
  return (await headers()) as unknown as Headers;
}

/**
 * The writable cookie store. Calling `set` on it throws during a React Server Component
 * render, which is what the `onUnappliable` policy exists to handle.
 */
export async function readCookieStore(): Promise<WritableCookieStore> {
  return (await cookies()) as unknown as WritableCookieStore;
}

/**
 * Builds the response through Next's own object.
 *
 * Never write headers with a low level Node response instead: ending a response by hand can
 * finish it before queued `Set-Cookie` headers are flushed, and the cookies vanish.
 */
export function createResponse(body: BodyInit | null, init: ResponseInit): Response {
  return new NextResponse(body, init);
}
