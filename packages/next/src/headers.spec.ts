import { createRelay as createCoreRelay } from '@concierge-kit/core';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from './frameworkMock.js';
import { forwardFromRequest } from './forward.js';
import { createPassthroughRoute } from './route.js';
import { createProxy, stampRequest } from './proxy.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

const relay = createCoreRelay({
  cookie: { allow: ['access_token'] },
  forward: {
    cookies: ['access_token'],
    headers: ['accept-language', /^x-trace-/],
    requestId: { header: 'x-request-id', generate: () => 'minted' },
  },
});

function incoming(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://app.example.com/dashboard', { headers });
}

beforeEach(() => {
  state.requestHeaders = new Headers();
});
afterEach(() => vi.unstubAllGlobals());

describe('request header propagation', () => {
  it('forwards the allowed headers and never the dangerous ones', async () => {
    const init = await forwardFromRequest(
      relay,
      incoming({
        'accept-language': 'ko',
        'x-trace-id': 't',
        host: 'app',
        connection: 'keep-alive',
        'x-secret': 's',
      }),
    );
    const out = new Headers(init.headers);
    expect(out.get('accept-language')).toBe('ko');
    expect(out.get('x-trace-id')).toBe('t');
    expect(out.get('host')).toBeNull();
    expect(out.get('connection')).toBeNull();
    expect(out.get('x-secret')).toBeNull();
  });

  it('applies through a passthrough route as well', async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    const handler = createPassthroughRoute(relay, 'https://api.test/x');
    await handler(
      incoming({ 'accept-language': 'ko', 'x-secret': 's', 'content-type': 'text/plain' }),
    );

    const out = new Headers(seen?.headers);
    expect(out.get('accept-language')).toBe('ko');
    expect(out.get('content-type')).toBe('text/plain');
    expect(out.get('x-secret')).toBeNull();
  });
});

describe('correlation id', () => {
  it('carries the id the browser sent', async () => {
    const init = await forwardFromRequest(relay, incoming({ 'x-request-id': 'from-browser' }));
    expect(new Headers(init.headers).get('x-request-id')).toBe('from-browser');
  });

  it('mints one id and reuses it across calls in the same request', async () => {
    const request = incoming({});
    const a = await forwardFromRequest(relay, request);
    const b = await forwardFromRequest(relay, request);
    expect(new Headers(a.headers).get('x-request-id')).toBe('minted');
    expect(new Headers(b.headers).get('x-request-id')).toBe('minted');
  });

  it('is stamped by the proxy so the render reads the same id', async () => {
    const proxy = createProxy(relay, { endpoint: 'https://api.test/refresh', when: () => false });
    const response = await proxy(incoming({}));
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe('minted');
  });

  it('is kept by the proxy when the browser sent one', () => {
    const response = stampRequest(relay, incoming({ 'x-request-id': 'browser' }));
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe('browser');
  });

  it('reads the proxy stamp from the ambient request in a server action', async () => {
    state.requestHeaders = new Headers({ 'x-request-id': 'stamped-by-proxy' });
    const init = await forwardFromRequest(relay);
    expect(new Headers(init.headers).get('x-request-id')).toBe('stamped-by-proxy');
  });
});
