import { createRelay as createCoreRelay } from '@concierge-kit/core';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, createProxy, rotateFromUpstream } from './proxy.js';

const relay = createCoreRelay({
  cookie: {
    allow: ['access_token', 'refresh_token'],
    domain: 'auto',
    secure: 'auto',
    sameSite: 'auto',
  },
  forward: { cookies: ['refresh_token'] },
});

function incoming(cookie?: string, url = 'https://app.example.com/dashboard'): NextRequest {
  return new NextRequest(url, { headers: cookie === undefined ? {} : { cookie } });
}

function refreshed(...cookies: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { headers });
}

/** What the rest of this request will read, which is the half that is easy to forget. */
function requestCookieAfter(response: { headers: Headers }): string | null {
  return response.headers.get('x-middleware-request-cookie');
}

describe('rotateFromUpstream', () => {
  it('sends the cookie to the browser', () => {
    const response = rotateFromUpstream(
      relay,
      incoming('access_token=stale'),
      refreshed('access_token=fresh; Path=/'),
    );
    expect(response.headers.getSetCookie()).toEqual(['access_token=fresh; Path=/']);
  });

  it('also hands the new value to the request already in flight', () => {
    const response = rotateFromUpstream(
      relay,
      incoming('access_token=stale; theme=dark'),
      refreshed('access_token=fresh; Path=/'),
    );
    expect(requestCookieAfter(response)).toBe('access_token=fresh; theme=dark');
  });

  it('adds a cookie the request never carried', () => {
    const response = rotateFromUpstream(
      relay,
      incoming('theme=dark'),
      refreshed('access_token=fresh'),
    );
    expect(requestCookieAfter(response)).toBe('theme=dark; access_token=fresh');
  });

  it('takes a deletion out of the request as well as out of the browser', () => {
    const response = rotateFromUpstream(
      relay,
      incoming('access_token=stale; theme=dark'),
      refreshed('access_token=; Max-Age=0'),
    );
    expect(requestCookieAfter(response)).toBe('theme=dark');
    expect(response.headers.getSetCookie()).toEqual(['access_token=; Max-Age=0']);
  });

  it('rotates nothing the policy does not allow', () => {
    const response = rotateFromUpstream(
      relay,
      incoming('access_token=stale'),
      refreshed('access_token=fresh', 'internal_trace=x'),
    );
    expect(requestCookieAfter(response)).toBe('access_token=fresh');
    expect(response.headers.getSetCookie()).toEqual(['access_token=fresh']);
  });

  it('rewrites attributes on the way out, judged against the incoming request', () => {
    const response = rotateFromUpstream(
      relay,
      incoming('access_token=stale', 'http://localhost:3000/dashboard'),
      refreshed('access_token=fresh; Domain=.example.com; Secure; SameSite=None'),
    );
    expect(response.headers.getSetCookie()).toEqual(['access_token=fresh; SameSite=Lax']);
  });

  it('reports names and reasons, never values', () => {
    const onRotate = vi.fn();
    rotateFromUpstream(relay, incoming(), refreshed('access_token=super-secret', 'internal=x'), {
      onRotate,
    });
    const result = onRotate.mock.calls[0]?.[0];

    expect(result.rotated).toEqual(['access_token']);
    expect(result.dropped).toEqual([{ name: 'internal', reason: 'not-allowed' }]);
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });
});

describe('clearSession', () => {
  it('ends the session for the browser and for this request at once', () => {
    const response = clearSession(incoming('access_token=a; refresh_token=r; theme=dark'), [
      'access_token',
      'refresh_token',
    ]);

    expect(requestCookieAfter(response)).toBe('theme=dark');
    expect(response.headers.getSetCookie()).toEqual([
      'access_token=; Path=/; Max-Age=0',
      'refresh_token=; Path=/; Max-Age=0',
    ]);
  });
});

describe('createProxy', () => {
  const endpoint = 'https://api.test/auth/refresh';
  let seen: { url: string; init: RequestInit } | undefined;

  beforeEach(() => {
    seen = undefined;
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubRefresh(response: Response): void {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen = { url: url.toString(), init };
      return response;
    });
  }

  it('does nothing when the condition says not to', async () => {
    stubRefresh(refreshed('access_token=fresh'));
    const proxy = createProxy(relay, { endpoint, when: () => false });
    const response = await proxy(incoming('access_token=still-good'));

    expect(seen).toBeUndefined();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('refreshes and rotates when the condition says to', async () => {
    stubRefresh(refreshed('access_token=fresh; Path=/'));
    const proxy = createProxy(relay, {
      endpoint,
      when: (request) => !request.cookies.has('access_token'),
    });
    const response = await proxy(incoming('refresh_token=r'));

    expect(seen?.url).toBe(endpoint);
    expect(seen?.init.method).toBe('POST');
    expect(new Headers(seen?.init.headers).get('cookie')).toBe('refresh_token=r');
    expect(response.headers.getSetCookie()).toEqual(['access_token=fresh; Path=/']);
    expect(requestCookieAfter(response)).toBe('refresh_token=r; access_token=fresh');
  });

  it('leaves the request alone when a failed refresh should be ignored', async () => {
    stubRefresh(new Response(null, { status: 401 }));
    const proxy = createProxy(relay, { endpoint, when: () => true });
    const response = await proxy(incoming('refresh_token=expired'));

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(requestCookieAfter(response)).toBeNull();
  });

  it('clears the session when a failed refresh should end it', async () => {
    stubRefresh(new Response(null, { status: 401 }));
    const proxy = createProxy(relay, { endpoint, when: () => true, onFailure: 'clear' });
    const response = await proxy(incoming('access_token=a; refresh_token=expired; theme=dark'));

    expect(requestCookieAfter(response)).toBe('theme=dark');
    expect(response.headers.getSetCookie()).toEqual([
      'access_token=; Path=/; Max-Age=0',
      'refresh_token=; Path=/; Max-Age=0',
    ]);
  });

  it('hands a failure to a function that wants to decide for itself', async () => {
    stubRefresh(new Response(null, { status: 500 }));
    const decide = vi.fn(() => clearSession(incoming(), ['access_token']));
    const proxy = createProxy(relay, { endpoint, when: () => true, onFailure: decide });
    await proxy(incoming('refresh_token=r'));

    expect(decide).toHaveBeenCalledOnce();
  });

  it('builds the endpoint from the request when given a function', async () => {
    stubRefresh(refreshed('access_token=fresh'));
    const proxy = createProxy(relay, {
      endpoint: (request) => `https://api.test${new URL(request.url).pathname}/refresh`,
      when: () => true,
    });
    await proxy(incoming('refresh_token=r'));

    expect(seen?.url).toBe('https://api.test/dashboard/refresh');
  });
});
