import { createRelay } from '@conciergekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from './frameworkMock.js';
import { createPassthroughRoute } from './route.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

const relay = createRelay({
  cookie: { allow: true, domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});

let seen: { url: string; init: RequestInit } | undefined;

beforeEach(() => {
  seen = undefined;
  state.requestHeaders = new Headers();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen = { url: url.toString(), init };
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'access_token=a; Path=/');
    return new Response('{"id":1}', { status: 201, headers });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPassthroughRoute', () => {
  it('passes the request on and hands the answer back with its cookies', async () => {
    const handler = createPassthroughRoute(relay, 'https://api.test/login');
    const response = await handler(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'access_token=a; theme=dark' },
        body: '{"id":"me"}',
      }),
    );

    expect(seen?.url).toBe('https://api.test/login');
    expect(seen?.init.method).toBe('POST');
    expect(new Headers(seen?.init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(seen?.init.headers).get('cookie')).toBe('access_token=a');
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"id":1}');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
  });

  it('carries the incoming query string to a target that has none', async () => {
    const handler = createPassthroughRoute(relay, 'https://api.test/search');
    await handler(new Request('https://app.example.com/api/search?q=hello&page=2'));
    expect(seen?.url).toBe('https://api.test/search?q=hello&page=2');
  });

  it('leaves a target that carries its own query alone', async () => {
    const handler = createPassthroughRoute(relay, 'https://api.test/search?fixed=1');
    await handler(new Request('https://app.example.com/api/search?q=hello'));
    expect(seen?.url).toBe('https://api.test/search?fixed=1');
  });

  it('builds the target from the request when given a function', async () => {
    const handler = createPassthroughRoute(
      relay,
      (request) => `https://api.test${new URL(request.url).pathname.replace('/api', '')}`,
    );
    await handler(new Request('https://app.example.com/api/users/7'));
    expect(seen?.url).toBe('https://api.test/users/7');
  });

  it('does not follow a backend redirect, so a login 302 reaches the browser', async () => {
    const handler = createPassthroughRoute(relay, 'https://api.test/login');
    await handler(new Request('https://app.example.com/api/login', { method: 'POST' }));
    expect(seen?.init.redirect).toBe('manual');
  });

  it('sends no body for a GET', async () => {
    const handler = createPassthroughRoute(relay, 'https://api.test/me');
    await handler(new Request('https://app.example.com/api/me'));
    expect(seen?.init.body).toBeUndefined();
  });

  it('forwards only the request headers it was told to', async () => {
    const handler = createPassthroughRoute(relay, 'https://api.test/me', {
      headers: ['accept-language'],
    });
    await handler(
      new Request('https://app.example.com/api/me', {
        headers: { 'accept-language': 'ko-KR', 'x-secret': 'leak' },
      }),
    );
    const headers = new Headers(seen?.init.headers);
    expect(headers.get('accept-language')).toBe('ko-KR');
    expect(headers.get('x-secret')).toBeNull();
  });
});
