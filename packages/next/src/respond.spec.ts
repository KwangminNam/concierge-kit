import { createRelay } from '@concierge-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from './frameworkMock.js';
import { toNextResponse } from './respond.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

const relay = createRelay({
  cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
});

function upstreamWith(cookies: string[], init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response('{"ok":true}', { ...init, headers });
}

beforeEach(() => {
  state.requestHeaders = new Headers();
  vi.restoreAllMocks();
});

describe('toNextResponse', () => {
  it('relays only the allowed cookies and keeps status and body', async () => {
    const upstream = upstreamWith(['access_token=a; Path=/', 'internal=x; Path=/'], {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });

    const response = await toNextResponse(upstream, relay);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('drops the hop-by-hop headers that would break the browser', async () => {
    const upstream = upstreamWith([], {
      headers: { 'content-encoding': 'gzip', 'content-length': '99', 'cache-control': 'no-store' },
    });
    const response = await toNextResponse(upstream, relay);

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rewrites for the current request read from the ambient headers', async () => {
    state.requestHeaders = new Headers({
      host: 'dev.example.test:3000',
      'x-forwarded-proto': 'http',
    });
    const upstream = upstreamWith(['access_token=a; Domain=.example.com; Secure; SameSite=None']);

    const response = await toNextResponse(upstream, relay);
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; SameSite=Lax']);
  });

  it('prefers an explicit request over the ambient one', async () => {
    state.requestHeaders = new Headers({ host: 'dev.example.test:3000' });
    const response = await toNextResponse(
      upstreamWith(['access_token=a; Domain=.example.com']),
      relay,
      { request: new Request('https://app.example.com/x') },
    );
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Domain=.example.com']);
  });

  it('reports what it relayed and dropped without any value', async () => {
    const onRelay = vi.fn();
    await toNextResponse(upstreamWith(['access_token=secret; Path=/', 'internal=x']), relay, {
      onRelay,
    });

    const result = onRelay.mock.calls[0]?.[0];
    expect(result.relayed).toEqual(['access_token']);
    expect(result.dropped).toEqual([{ name: 'internal', reason: 'not-allowed' }]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('lets the caller override the status and add headers', async () => {
    const response = await toNextResponse(upstreamWith([], { status: 200 }), relay, {
      status: 202,
      headers: { 'x-relay': 'yes' },
    });
    expect(response.status).toBe(202);
    expect(response.headers.get('x-relay')).toBe('yes');
  });
});
