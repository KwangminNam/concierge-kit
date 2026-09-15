import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  forwardRequestCookies,
  relaySetCookies,
  splitSetCookieString,
  type RelayContext,
} from '@concierge-kit/core';

/**
 * conciergekit does not call `fetch`, and does not require you to.
 *
 * `forward` hands back a `RequestInit` because that is the shape most callers want, but the
 * only thing inside it that conciergekit owns is a `cookie` header, which any client can take.
 * On the way back, the relay reads a `Headers`, which you can build from whatever shape your
 * client reports. This suite proves it using `node:http` alone.
 */
let backend: Server;
let port: number;

beforeAll(async () => {
  backend = http.createServer((request, response) => {
    response.setHeader('Set-Cookie', [
      'access_token=granted; Path=/; Domain=.example.com; Secure; SameSite=None; Partitioned',
      'internal_trace=must-not-leak; Path=/',
    ]);
    response.end(JSON.stringify({ sawCookie: request.headers.cookie ?? null }));
  });
  port = await new Promise((resolve) => {
    backend.listen(0, '127.0.0.1', () => resolve((backend.address() as AddressInfo).port));
  });
});

afterAll(() => backend.close());

const policy = {
  allow: ['access_token'],
  domain: 'auto',
  secure: 'auto',
  sameSite: 'auto',
} as const;
const context: RelayContext = { proto: 'http', host: 'dev.example.test:3000' };

function call(cookieHeader: string | null): Promise<{
  setCookie: string[] | string | undefined;
  body: { sawCookie: string | null };
}> {
  return new Promise((resolve) => {
    const headers = cookieHeader === null ? {} : { cookie: cookieHeader };
    http
      .request({ host: '127.0.0.1', port, path: '/', headers }, (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ setCookie: response.headers['set-cookie'], body: JSON.parse(body) }),
        );
      })
      .end();
  });
}

/** Whatever shape the client reports, turn it into the `Headers` the relay reads. */
function toHeaders(setCookie: string[] | string | undefined): Headers {
  const lines = Array.isArray(setCookie)
    ? setCookie
    : setCookie === undefined
      ? []
      : splitSetCookieString(setCookie);
  const headers = new Headers();
  for (const line of lines) headers.append('set-cookie', line);
  return headers;
}

describe('a client that is not fetch', () => {
  it('takes the cookie header the policy built', async () => {
    const init = forwardRequestCookies(
      new Headers({ cookie: 'access_token=from-browser; theme=dark' }),
      undefined,
      { cookies: ['access_token'] },
    );
    const cookieHeader = new Headers(init.headers).get('cookie');

    expect(cookieHeader).toBe('access_token=from-browser');
    const { body } = await call(cookieHeader);
    expect(body.sawCookie).toBe('access_token=from-browser');
  });

  it('relays the answer back through a Headers built by hand', async () => {
    const { setCookie } = await call(null);
    const to = new Headers();
    const result = relaySetCookies(toHeaders(setCookie), to, policy, context);

    expect(to.getSetCookie()).toEqual(['access_token=granted; Path=/; SameSite=Lax']);
    expect(result.dropped).toEqual([{ name: 'internal_trace', reason: 'not-allowed' }]);
  });

  it('recovers cookies from a client that joined them into one string', () => {
    const joined =
      'a=1; Expires=Tue, 21 Oct 2025 07:28:00 GMT; Path=/, access_token=granted; Path=/';
    const to = new Headers();
    relaySetCookies(toHeaders(joined), to, { allow: true }, context);

    expect(to.getSetCookie()).toEqual([
      'a=1; Expires=Tue, 21 Oct 2025 07:28:00 GMT; Path=/',
      'access_token=granted; Path=/',
    ]);
  });
});
