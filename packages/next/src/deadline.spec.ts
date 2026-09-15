import { createRelay as createCoreRelay, DEADLINE_DEFAULTS } from '@concierge-kit/core';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from './frameworkMock.js';
import { createProxy, rotateFromUpstream, stampRequest } from './proxy.js';
import { forwardFromRequest } from './forward.js';
import { createRelay } from './createRelay.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

const relay = createCoreRelay({
  cookie: { allow: ['access_token'] },
  forward: { cookies: ['access_token'] },
  deadline: { budget: 3000 },
});

function incoming(cookie?: string): NextRequest {
  return new NextRequest('https://app.example.com/dashboard', {
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** The request headers the rest of this request will see. */
function stampSeenByRender(response: { headers: Headers }): number | null {
  const raw = response.headers.get(`x-middleware-request-${DEADLINE_DEFAULTS.carrier}`);
  return raw === null ? null : Number(raw);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  state.requestHeaders = new Headers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the proxy starts the clock', () => {
  it('stamps a request that needed no refresh', async () => {
    const proxy = createProxy(relay, { endpoint: 'https://api.test/refresh', when: () => false });
    const response = await proxy(incoming('access_token=fine'));
    expect(stampSeenByRender(response)).toBe(1_700_000_000_000 + 3000);
  });

  it('stamps a request that was refreshed', async () => {
    vi.stubGlobal('fetch', async () => {
      const headers = new Headers({ 'set-cookie': 'access_token=fresh' });
      return new Response(null, { headers });
    });
    const proxy = createProxy(relay, { endpoint: 'https://api.test/refresh', when: () => true });
    const response = await proxy(incoming('refresh_token=r'));

    expect(stampSeenByRender(response)).toBe(1_700_000_000_000 + 3000);
    expect(response.headers.getSetCookie()).toEqual(['access_token=fresh']);
  });

  it('stamps a request whose refresh failed, on either failure path', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }));
    const ignore = createProxy(relay, { endpoint: 'https://api.test/refresh', when: () => true });
    const clear = createProxy(relay, {
      endpoint: 'https://api.test/refresh',
      when: () => true,
      onFailure: 'clear',
    });

    expect(stampSeenByRender(await ignore(incoming('refresh_token=x')))).toBe(
      1_700_000_000_000 + 3000,
    );
    expect(stampSeenByRender(await clear(incoming('refresh_token=x')))).toBe(
      1_700_000_000_000 + 3000,
    );
  });

  it('overwrites a stamp that arrived from the outside', () => {
    const request = new NextRequest('https://app.example.com/', {
      headers: { [DEADLINE_DEFAULTS.carrier]: '9999999999999' },
    });
    expect(stampSeenByRender(stampRequest(relay, request))).toBe(1_700_000_000_000 + 3000);
  });

  it('stamps nothing when no deadline is configured', () => {
    const plain = createCoreRelay({ cookie: { allow: true } });
    const response = stampRequest(plain, incoming());
    expect(stampSeenByRender(response)).toBeNull();
  });

  it('keeps stamping through a manual rotation', () => {
    const response = rotateFromUpstream(
      relay,
      incoming(),
      new Response(null, { headers: { 'set-cookie': 'access_token=fresh' } }),
    );
    expect(stampSeenByRender(response)).toBe(1_700_000_000_000 + 3000);
  });
});

describe('the render spends the budget', () => {
  function stampedAmbient(elapsedMs: number): void {
    const headers = new Headers({ cookie: 'access_token=a' });
    headers.set(DEADLINE_DEFAULTS.carrier, String(1_700_000_000_000 + 3000));
    state.requestHeaders = headers;
    vi.setSystemTime(1_700_000_000_000 + elapsedMs);
  }

  it('hands the backend what is left, from the ambient request', async () => {
    stampedAmbient(2100);
    const init = await forwardFromRequest(relay);

    expect(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)).toBe('900');
    expect(new Headers(init.headers).get('cookie')).toBe('access_token=a');
    expect(init.signal?.aborted).toBe(false);
  });

  it('exposes the remaining budget and a signal for a call site to use directly', async () => {
    stampedAmbient(1000);
    const next = createRelay({ cookie: { allow: true }, deadline: { budget: 3000 } });
    const view = await next.deadline();

    expect(view?.remaining).toBe(2000);
    expect(view?.signal.aborted).toBe(false);
  });

  it('gives an already aborted call once the budget is gone', async () => {
    stampedAmbient(3500);
    const init = await forwardFromRequest(relay);

    expect(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)).toBe('0');
    expect(init.signal?.aborted).toBe(true);
  });
});

describe('without a proxy, the first call starts the clock', () => {
  it('shares one budget across calls in a route handler', async () => {
    const request = incoming('access_token=a');
    const first = await forwardFromRequest(relay, request);
    vi.advanceTimersByTime(1200);
    const second = await forwardFromRequest(relay, request);

    expect(new Headers(first.headers).get(DEADLINE_DEFAULTS.header)).toBe('3000');
    expect(new Headers(second.headers).get(DEADLINE_DEFAULTS.header)).toBe('1800');
  });

  it('shares one budget across calls in a server action', async () => {
    state.requestHeaders = new Headers({ cookie: 'access_token=a' });
    const first = await forwardFromRequest(relay);
    vi.advanceTimersByTime(500);
    const second = await forwardFromRequest(relay);

    expect(new Headers(first.headers).get(DEADLINE_DEFAULTS.header)).toBe('3000');
    expect(new Headers(second.headers).get(DEADLINE_DEFAULTS.header)).toBe('2500');
  });

  it('defers to a stamp the proxy already made', async () => {
    const request = new NextRequest('https://app.example.com/', {
      headers: { [DEADLINE_DEFAULTS.carrier]: String(1_700_000_000_000 + 1000) },
    });
    const init = await forwardFromRequest(relay, request);
    expect(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)).toBe('1000');
  });

  it('no longer warns about a missing proxy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await forwardFromRequest(relay, incoming());
    expect(warn).not.toHaveBeenCalled();
  });
});
