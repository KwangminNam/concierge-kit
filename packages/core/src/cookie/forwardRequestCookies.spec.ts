import { describe, expect, it } from 'vitest';
import { forwardRequestCookies, parseCookieHeader } from './forwardRequestCookies.js';

function browserRequest(cookie: string): Request {
  return new Request('https://app.example.com/', { headers: { cookie } });
}

describe('parseCookieHeader', () => {
  it('splits pairs and keeps an equals sign inside a value', () => {
    expect(parseCookieHeader('a=1; jwt=aa.bb==; c=3')).toEqual([
      { name: 'a', value: '1' },
      { name: 'jwt', value: 'aa.bb==' },
      { name: 'c', value: '3' },
    ]);
  });

  it('returns nothing for an absent header', () => {
    expect(parseCookieHeader(null)).toEqual([]);
  });
});

describe('forwardRequestCookies', () => {
  it('carries only the allowed cookies to the backend', () => {
    const init = forwardRequestCookies(
      browserRequest('access_token=a; theme=dark; refresh_token=r'),
      { method: 'POST' },
      { cookies: ['access_token', 'refresh_token'] },
    );
    expect(new Headers(init.headers).get('cookie')).toBe('access_token=a; refresh_token=r');
    expect(init.method).toBe('POST');
  });

  it('sends no cookie at all when the policy is omitted', () => {
    const init = forwardRequestCookies(browserRequest('access_token=a'));
    expect(new Headers(init.headers).get('cookie')).toBeNull();
  });

  it('leaves a cookie header the caller set when nothing matches', () => {
    const init = forwardRequestCookies(browserRequest('theme=dark'), {
      headers: { cookie: 'explicit=1' },
    });
    expect(new Headers(init.headers).get('cookie')).toBe('explicit=1');
  });

  it('renames on the way to the backend', () => {
    const init = forwardRequestCookies(browserRequest('web_sid=a'), undefined, {
      cookies: true,
      rename: { toUpstream: (name) => name.replace(/^web_/, '') },
    });
    expect(new Headers(init.headers).get('cookie')).toBe('sid=a');
  });

  it('keeps the caller other headers', () => {
    const init = forwardRequestCookies(
      browserRequest('a=1'),
      {
        headers: { 'content-type': 'application/json' },
      },
      { cookies: true },
    );
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('cookie')).toBe('a=1');
  });

  it('declares half duplex for a streamed body', () => {
    const body = new ReadableStream();
    const init = forwardRequestCookies(
      browserRequest('a=1'),
      { method: 'POST', body },
      {
        cookies: true,
      },
    );
    expect((init as { duplex?: string }).duplex).toBe('half');
  });

  it('accepts a bare Headers as the source', () => {
    const init = forwardRequestCookies(new Headers({ cookie: 'a=1' }), undefined, {
      cookies: true,
    });
    expect(new Headers(init.headers).get('cookie')).toBe('a=1');
  });
});

describe('headers wrappers that expose a headers field', () => {
  it('treats a Next style readonly headers object as headers, not as a request', () => {
    // Next's headers() returns a wrapper carrying a `headers` field of its own. Asking whether
    // an object "has headers" mistakes it for a request and reads the wrong thing.
    const readonlyHeaders = Object.assign(new Headers({ cookie: 'access_token=a' }), {
      headers: { unrelated: true },
    }) as unknown as Headers;

    const init = forwardRequestCookies(readonlyHeaders, undefined, { cookies: true });
    expect(new Headers(init.headers).get('cookie')).toBe('access_token=a');
  });
});
