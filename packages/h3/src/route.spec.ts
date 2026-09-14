import { afterEach, describe, expect, it } from 'vitest';
import { createRelay } from './createRelay.js';
import { startBackend, startHandler, type TestServer } from './testServer.js';

const relay = createRelay({
  cookie: { allow: true, domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});

function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const open: TestServer[] = [];
afterEach(() => {
  for (const server of open.splice(0)) server.close();
});

interface Seen {
  method: string;
  url: string;
  cookie: string | null;
  contentType: string | null;
  secret: string | null;
  body: string;
}

async function echoBackend(status = 200, extraHeaders: Record<string, string> = {}) {
  const server = await startBackend((request) => ({
    status,
    headers: {
      'content-type': 'application/json',
      'set-cookie': ['access_token=a; Path=/'],
      ...extraHeaders,
    },
    body: JSON.stringify({
      method: request.method ?? '',
      url: request.url ?? '',
      cookie: request.headers.cookie ?? null,
      contentType: firstHeader(request.headers['content-type']),
      secret: firstHeader(request.headers['x-secret']),
    } satisfies Omit<Seen, 'body'>),
  }));
  open.push(server);
  return server;
}

async function route(target: string, options?: Parameters<typeof relay.route>[1]) {
  const server = await startHandler('/api/login', relay.route(target, options));
  open.push(server);
  return server;
}

describe('route', () => {
  it('passes the request on and hands the answer back with its cookies', async () => {
    const backend = await echoBackend(201);
    const front = await route(`${backend.origin}/login`);

    const response = await fetch(`${front.origin}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'access_token=a; theme=dark' },
      body: '{"id":"me"}',
    });
    const seen = (await response.json()) as Seen;

    expect(response.status).toBe(201);
    expect(seen.method).toBe('POST');
    expect(seen.cookie).toBe('access_token=a');
    expect(seen.contentType).toBe('application/json');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
  });

  it('carries the incoming query string to a target that has none', async () => {
    const backend = await echoBackend();
    const front = await route(`${backend.origin}/search`);

    const response = await fetch(`${front.origin}/api/login?q=hello&page=2`);
    expect(((await response.json()) as Seen).url).toBe('/search?q=hello&page=2');
  });

  it('leaves a target that carries its own query alone', async () => {
    const backend = await echoBackend();
    const front = await route(`${backend.origin}/search?fixed=1`);

    const response = await fetch(`${front.origin}/api/login?q=hello`);
    expect(((await response.json()) as Seen).url).toBe('/search?fixed=1');
  });

  it('forwards only the request headers it was told to', async () => {
    const backend = await echoBackend();
    const front = await route(`${backend.origin}/login`);

    const response = await fetch(`${front.origin}/api/login`, {
      headers: { 'x-secret': 'leak', accept: 'application/json' },
    });
    expect(((await response.json()) as Seen).secret).toBeNull();
  });

  it('does not follow a backend redirect, so a login 302 reaches the browser', async () => {
    const backend = await echoBackend(302, { location: '/dashboard' });
    const front = await route(`${backend.origin}/login`);

    const response = await fetch(`${front.origin}/api/login`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
  });

  it('sends no body for a GET', async () => {
    const backend = await echoBackend();
    const front = await route(`${backend.origin}/login`);

    const response = await fetch(`${front.origin}/api/login`);
    expect(((await response.json()) as Seen).method).toBe('GET');
  });
});
