import { createRelay } from '@concierge-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { withRelay } from './withRelay.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

const relay = createRelay({
  cookie: { allow: ['access_token'] },
  forward: { cookies: ['access_token'] },
});

function upstreamWith(...cookies: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response('{"upstream":true}', { headers });
}

describe('withRelay', () => {
  it('attaches queued cookies to the handler own response', async () => {
    const handler = withRelay(relay, async (_request, { relayFrom }) => {
      relayFrom(upstreamWith('access_token=a; Path=/', 'internal=x'));
      return new Response('{"mine":true}', { status: 200 });
    });

    const response = await handler(new Request('https://app.example.com/api/login'));
    expect(await response.text()).toBe('{"mine":true}');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
  });

  it('gives the handler a forward helper that carries the browser cookies', async () => {
    let init: RequestInit | undefined;
    const handler = withRelay(relay, async (_request, { forward }) => {
      init = forward({ method: 'POST' });
      return new Response(null, { status: 204 });
    });

    await handler(
      new Request('https://app.example.com/api/x', { headers: { cookie: 'access_token=a; ad=1' } }),
    );
    expect(new Headers(init?.headers).get('cookie')).toBe('access_token=a');
  });

  it('returns the handler response untouched when nothing was queued', async () => {
    const original = new Response('{"mine":true}', { status: 418 });
    const handler = withRelay(relay, async () => original);
    const response = await handler(new Request('https://app.example.com/x'));
    expect(response).toBe(original);
  });

  it('passes the backend response straight through when asked to', async () => {
    const handler = withRelay(relay, async (_request, { respond }) =>
      respond(upstreamWith('access_token=a; Path=/')),
    );
    const response = await handler(new Request('https://app.example.com/x'));
    expect(await response.text()).toBe('{"upstream":true}');
    expect(response.headers.getSetCookie()).toEqual(['access_token=a; Path=/']);
  });

  it('hands the handler the extra route arguments Next passes', async () => {
    const handler = withRelay<[{ params: Promise<{ id: string }> }]>(
      relay,
      async (_request, _relay, context) => Response.json(await context.params),
    );
    const response = await handler(new Request('https://app.example.com/x'), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(await response.json()).toEqual({ id: '7' });
  });
});
