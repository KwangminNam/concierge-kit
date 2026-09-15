import { createApp, defineEventHandler, getRequestHeader, toNodeListener } from 'h3';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelay } from './createRelay.js';
import { startBackend, type TestServer } from './testServer.js';

const relay = createRelay({
  cookie: {
    allow: ['access_token', 'refresh_token'],
    domain: 'auto',
    secure: 'auto',
    sameSite: 'auto',
  },
  forward: { cookies: ['refresh_token'] },
});

const open: TestServer[] = [];
afterEach(() => {
  for (const server of open.splice(0)) server.close();
});

/** A front server with the refresh middleware ahead of a route that reports what it saw. */
async function front(backendOrigin: string, onFailure?: 'continue' | 'clear'): Promise<TestServer> {
  const app = createApp();
  app.use(
    relay.refresh({
      endpoint: `${backendOrigin}/refresh`,
      when: (event) => !getRequestHeader(event, 'cookie')?.includes('access_token='),
      ...(onFailure ? { onFailure } : {}),
    }),
  );
  app.use(
    '/page',
    defineEventHandler((event) => ({ seenByHandler: getRequestHeader(event, 'cookie') ?? null })),
  );
  const server = createServer(toNodeListener(app));
  const port = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
  const handle = { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
  open.push(handle);
  return handle;
}

async function refreshBackend(accept: boolean): Promise<TestServer> {
  const server = await startBackend((request) => {
    const ok = accept && (request.headers.cookie ?? '').includes('refresh_token=valid');
    const headers: Record<string, string | string[]> = ok
      ? {
          'set-cookie': [
            'access_token=rotated; Path=/; Domain=.example.com; Secure; SameSite=None',
            'internal=x',
          ],
        }
      : {};
    return { status: ok ? 200 : 401, headers, body: '{}' };
  });
  open.push(server);
  return server;
}

describe('refresh middleware', () => {
  it('lets the handler running right after read a token the browser never sent', async () => {
    const backend = await refreshBackend(true);
    const server = await front(backend.origin);

    const response = await fetch(`${server.origin}/page`, {
      headers: { cookie: 'refresh_token=valid; theme=dark' },
    });
    const body = (await response.json()) as { seenByHandler: string };

    expect(body.seenByHandler).toBe('refresh_token=valid; theme=dark; access_token=rotated');
    expect(response.headers.getSetCookie()).toEqual([
      'access_token=rotated; Path=/; Secure; SameSite=None',
    ]);
  });

  it('does nothing when the condition says not to', async () => {
    const backend = await refreshBackend(true);
    const server = await front(backend.origin);
    const response = await fetch(`${server.origin}/page`, {
      headers: { cookie: 'access_token=fine' },
    });

    expect(((await response.json()) as { seenByHandler: string }).seenByHandler).toBe(
      'access_token=fine',
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('leaves the request alone when a failed refresh should be ignored', async () => {
    const backend = await refreshBackend(false);
    const server = await front(backend.origin);
    const response = await fetch(`${server.origin}/page`, {
      headers: { cookie: 'refresh_token=expired' },
    });

    expect(((await response.json()) as { seenByHandler: string }).seenByHandler).toBe(
      'refresh_token=expired',
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('ends the session for this request too when a failed refresh should clear it', async () => {
    const backend = await refreshBackend(false);
    const server = await front(backend.origin, 'clear');
    const response = await fetch(`${server.origin}/page`, {
      headers: { cookie: 'access_token=old; refresh_token=expired; theme=dark' },
    });

    // access_token is present so `when` is false here; force the path with only a refresh token
    const forced = await fetch(`${server.origin}/page`, {
      headers: { cookie: 'refresh_token=expired; theme=dark' },
    });
    expect(((await forced.json()) as { seenByHandler: string }).seenByHandler).toBe('theme=dark');
    expect(forced.headers.getSetCookie()).toEqual([
      'access_token=; Path=/; Max-Age=0',
      'refresh_token=; Path=/; Max-Age=0',
    ]);
    void response;
  });

  it('reports names and reasons, never values', async () => {
    const backend = await refreshBackend(true);
    const onRotate = vi.fn();
    const app = createApp();
    app.use(relay.refresh({ endpoint: `${backend.origin}/refresh`, when: () => true, onRotate }));
    app.use(
      '/page',
      defineEventHandler(() => 'ok'),
    );
    const server = createServer(toNodeListener(app));
    const port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
    );
    open.push({ origin: '', close: () => server.close() });

    await fetch(`http://127.0.0.1:${port}/page`, { headers: { cookie: 'refresh_token=valid' } });
    const result = onRotate.mock.calls[0]?.[0];
    expect(result.rotated).toEqual(['access_token']);
    expect(result.dropped).toEqual([{ name: 'internal', reason: 'not-allowed' }]);
    expect(JSON.stringify(result)).not.toContain('rotated;');
  });
});
