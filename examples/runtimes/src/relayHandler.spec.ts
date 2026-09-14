import { createApp, toNodeListener } from 'h3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelayHandler } from './relayHandler.js';

/**
 * Runs the README recipe against a real h3 server, so the documented Nuxt path cannot rot
 * without a test going red. The scenarios match the Next end-to-end suite one for one.
 */
let backend: Server;
let front: Server;
let origin: string;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  backend = createServer((request, response) => {
    response.setHeader('Set-Cookie', [
      'access_token=granted; Path=/; Domain=.example.com; Secure; SameSite=None; Partitioned; HttpOnly',
      'internal_trace=must-not-leak; Path=/',
    ]);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, sawCookie: request.headers.cookie ?? null }));
  });
  const backendPort = await listen(backend);

  const app = createApp();
  app.use(
    '/api/login',
    createRelayHandler({
      target: `http://127.0.0.1:${backendPort}/login`,
      cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
      forward: { cookies: ['access_token'] },
    }),
  );

  front = createServer(toNodeListener(app));
  origin = `http://127.0.0.1:${await listen(front)}`;
});

afterAll(() => {
  front.close();
  backend.close();
});

describe('the Nuxt and h3 recipe', () => {
  it('fixes the attributes that would make a browser discard the cookie', async () => {
    const response = await fetch(`${origin}/api/login`, {
      headers: { cookie: 'access_token=from-browser; theme=dark' },
    });
    const [cookie] = response.headers.getSetCookie();

    expect(cookie).toBe('access_token=granted; Path=/; SameSite=Lax; Partitioned; HttpOnly');
    expect(cookie).not.toContain('Domain');
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('Partitioned');
  });

  it('relays nothing outside the allow list', async () => {
    const response = await fetch(`${origin}/api/login`);
    const body = (await response.json()) as { result: { relayed: string[]; dropped: unknown[] } };

    expect(body.result.relayed).toEqual(['access_token']);
    expect(body.result.dropped).toEqual([{ name: 'internal_trace', reason: 'not-allowed' }]);
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('carries only the allowed browser cookies to the backend', async () => {
    const response = await fetch(`${origin}/api/login`, {
      headers: { cookie: 'access_token=from-browser; theme=dark' },
    });
    const body = (await response.json()) as { backend: { sawCookie: string | null } };

    expect(body.backend.sawCookie).toBe('access_token=from-browser');
  });
});
