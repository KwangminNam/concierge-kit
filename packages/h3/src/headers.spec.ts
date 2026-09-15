import { defineEventHandler } from 'h3';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay } from './createRelay.js';
import { startBackend, startHandler, type TestServer } from './testServer.js';

const relay = createRelay({
  cookie: { allow: true },
  forward: {
    cookies: ['access_token'],
    headers: ['accept-language'],
    requestId: { header: 'x-request-id', generate: () => 'minted' },
  },
});

const open: TestServer[] = [];
afterEach(() => {
  for (const server of open.splice(0)) server.close();
});

describe('header propagation and correlation id in h3', () => {
  it('forwards allowed headers, mints one id per request, and never forwards host', async () => {
    const backend = await startBackend((request) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lang: request.headers['accept-language'] ?? null,
        id: request.headers['x-request-id'] ?? null,
        host: request.headers.host ?? null,
      }),
    }));
    open.push(backend);

    const front = await startHandler(
      '/api',
      defineEventHandler(async (event) => {
        const a = await (await fetch(backend.origin, relay.forward(event))).json();
        const b = await (await fetch(backend.origin, relay.forward(event))).json();
        return { a, b };
      }),
    );
    open.push(front);

    const body = (await (
      await fetch(`${front.origin}/api`, { headers: { 'accept-language': 'ko' } })
    ).json()) as {
      a: { lang: string; id: string; host: string };
      b: { id: string };
    };
    expect(body.a.lang).toBe('ko');
    expect(body.a.id).toBe('minted');
    expect(body.b.id).toBe('minted');
    expect(body.a.host).not.toContain(front.origin.replace('http://', ''));
  });

  it('carries the id the browser sent', async () => {
    const backend = await startBackend((request) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: request.headers['x-request-id'] ?? null }),
    }));
    open.push(backend);
    const front = await startHandler(
      '/api',
      defineEventHandler(async (event) =>
        (await fetch(backend.origin, relay.forward(event))).json(),
      ),
    );
    open.push(front);

    const body = (await (
      await fetch(`${front.origin}/api`, { headers: { 'x-request-id': 'browser' } })
    ).json()) as { id: string };
    expect(body.id).toBe('browser');
  });
});
