import { NextResponse } from 'next/server';
/**
 * Test double for the framework seam.
 *
 * That every Next.js API sits behind one module is what makes this possible: a test replaces
 * the whole framework by mocking a single file, including the cookie store refusing a write
 * the way it does during a React Server Component render.
 *
 * Not shipped: the bundler entry point is `index.ts` alone.
 */
export interface FrameworkState {
  requestHeaders: Headers;
  setCookie: (init: unknown) => void;
}

export const state: FrameworkState = {
  requestHeaders: new Headers(),
  setCookie: () => {},
};

export const frameworkMock = {
  continueRequest: (headers?: Headers): NextResponse =>
    headers === undefined ? NextResponse.next() : NextResponse.next({ request: { headers } }),
  readRequestHeaders: async (): Promise<Headers> => state.requestHeaders,
  readCookieStore: async (): Promise<{ set: (init: unknown) => void }> => ({
    set: (init: unknown) => state.setCookie(init),
  }),
  createResponse: (body: BodyInit | null, init: ResponseInit): Response => new Response(body, init),
};
