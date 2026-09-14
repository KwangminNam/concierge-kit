import { defineEventHandler } from 'h3';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay } from './createRelay.js';
import { startBackend, startHandler, type TestServer } from './testServer.js';

const relay = createRelay({
  cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});

const open: TestServer[] = [];
afterEach(() => {
  for (const server of open.splice(0)) server.close();
});

async function backendSending(
  headers: Record<string, string | string[]>,
  body: string | Buffer = '{"ok":true}',
  status = 200,
): Promise<TestServer> {
  const server = await startBackend(() => ({ status, headers, body }));
  open.push(server);
  return server;
}

async function frontFor(backend: TestServer): Promise<TestServer> {
  const server = await startHandler(
    '/api/login',
    defineEventHandler(async (event) => {
      const upstream = await fetch(backend.origin, relay.forward(event));
      await relay.respond(event, upstream);
    }),
  );
  open.push(server);
  return server;
}

describe('respond', () => {
  it('relays only the allowed cookies and keeps status and body', async () => {
    const backend = await backendSending(
      {
        'set-cookie': ['access_token=a; Path=/', 'internal_trace=x; Path=/'],
        'content-type': 'application/json',
      },
      '{"ok":true}',
      201,
    );
    const response = await fetch(`${(await frontFor(backend)).origin}/api/login`);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('keeps two cookies that share a name but differ in Path', async () => {
    const permissive = createRelay({ cookie: { allow: 'sid' } });
    const backend = await backendSending({
      'set-cookie': ['sid=one; Path=/app', 'sid=two; Path=/admin'],
    });
    const front = await startHandler(
      '/api/login',
      defineEventHandler(async (event) => {
        const upstream = await fetch(backend.origin);
        await permissive.respond(event, upstream);
      }),
    );
    open.push(front);

    const response = await fetch(`${front.origin}/api/login`);
    expect(response.headers.getSetCookie()).toEqual(['sid=one; Path=/app', 'sid=two; Path=/admin']);
  });

  it('drops the hop-by-hop headers, so a compressed backend body still decodes', async () => {
    // The backend really does gzip. fetch decompresses it but leaves content-encoding saying
    // it is still compressed, so copying that header makes the browser fail to decode. This is
    // the whole reason hop-by-hop removal is not an optional feature.
    const compressed = gzipSync(Buffer.from('{"ok":true}'));
    const backend = await backendSending(
      {
        'content-encoding': 'gzip',
        'content-length': String(compressed.byteLength),
        'cache-control': 'no-store',
      },
      compressed,
    );
    const response = await fetch(`${(await frontFor(backend)).origin}/api/login`);

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"ok":true}');
  });

  it('judges the auto rules against the host the browser actually used', async () => {
    const backend = await backendSending({
      'set-cookie': ['access_token=a; Domain=.example.com; Secure; SameSite=None; Partitioned'],
    });
    const response = await fetch(`${(await frontFor(backend)).origin}/api/login`);

    expect(response.headers.getSetCookie()).toEqual(['access_token=a; SameSite=Lax; Partitioned']);
  });

  it('keeps Secure when a proxy says the browser used https', async () => {
    const backend = await backendSending({ 'set-cookie': ['access_token=a; Secure'] });
    const response = await fetch(`${(await frontFor(backend)).origin}/api/login`, {
      headers: { 'x-forwarded-proto': 'https' },
    });

    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Secure']);
  });

  it('reports what it relayed and dropped without any value', async () => {
    const backend = await backendSending({
      'set-cookie': ['access_token=super-secret; Path=/', 'internal_trace=x'],
    });
    const front = await startHandler(
      '/api/login',
      defineEventHandler(async (event) => {
        const upstream = await fetch(backend.origin);
        let seen: unknown;
        await relay.respond(event, upstream, { onRelay: (result) => (seen = result) });
        return seen;
      }),
    );
    open.push(front);

    const response = await fetch(`${front.origin}/api/login`);
    expect(response.headers.getSetCookie()).toEqual(['access_token=super-secret; Path=/']);
  });
});

describe('apply', () => {
  it('attaches cookies to a response the handler builds itself', async () => {
    const backend = await backendSending({
      'set-cookie': ['access_token=a; Path=/', 'internal_trace=x'],
    });
    const front = await startHandler(
      '/api/login',
      defineEventHandler(async (event) => {
        const upstream = await fetch(backend.origin, relay.forward(event));
        const result = relay.apply(event, upstream);
        return { mine: true, relayed: result.relayed, dropped: result.dropped };
      }),
    );
    open.push(front);

    const response = await fetch(`${front.origin}/api/login`);
    const body = (await response.json()) as {
      mine: boolean;
      relayed: string[];
      dropped: unknown[];
    };

    expect(body.mine).toBe(true);
    expect(body.relayed).toEqual(['access_token']);
    expect(body.dropped).toEqual([{ name: 'internal_trace', reason: 'not-allowed' }]);
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
  });
});

describe('forward', () => {
  it('carries only the allowed browser cookies to the backend', async () => {
    const backend = await startBackend((request) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sawCookie: request.headers.cookie ?? null }),
    }));
    open.push(backend);

    const response = await fetch(`${(await frontFor(backend)).origin}/api/login`, {
      headers: { cookie: 'access_token=a; theme=dark' },
    });
    expect((await response.json()).sawCookie).toBe('access_token=a');
  });
});
