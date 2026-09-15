import { DEADLINE_DEFAULTS } from '@concierge-kit/core';
import { defineEventHandler } from 'h3';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay } from './createRelay.js';
import { startBackend, startHandler, type TestServer } from './testServer.js';

const relay = createRelay({
  cookie: { allow: true },
  forward: { cookies: true },
  deadline: { budget: 400 },
});

const open: TestServer[] = [];
afterEach(() => {
  for (const server of open.splice(0)) server.close();
});

async function slowBackend(): Promise<TestServer> {
  const server = await startBackend((request) => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deadline: request.headers[DEADLINE_DEFAULTS.header] ?? null }),
  }));
  open.push(server);
  return server;
}

describe('the budget in h3', () => {
  it('starts on the first call and hands the backend what is left', async () => {
    const backend = await slowBackend();
    const front = await startHandler(
      '/api',
      defineEventHandler(async (event) => {
        const upstream = await fetch(backend.origin, relay.forward(event));
        return upstream.json();
      }),
    );
    open.push(front);

    const seen = (await (await fetch(`${front.origin}/api`)).json()) as { deadline: string };
    const sent = Number(seen.deadline);
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThanOrEqual(400);
  });

  it('shares one clock across calls in the same request', async () => {
    const backend = await slowBackend();
    const front = await startHandler(
      '/api',
      defineEventHandler(async (event) => {
        const first = relay.deadline(event)?.remaining ?? -1;
        await new Promise((resolve) => setTimeout(resolve, 120));
        const second = relay.deadline(event)?.remaining ?? -1;
        const init = relay.forward(event);
        return {
          first,
          second,
          sent: Number(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)),
        };
      }),
    );
    open.push(front);
    void backend;

    const body = (await (await fetch(`${front.origin}/api`)).json()) as {
      first: number;
      second: number;
      sent: number;
    };
    expect(body.first).toBeGreaterThan(body.second);
    expect(body.first - body.second).toBeGreaterThanOrEqual(100);
    expect(body.sent).toBeLessThanOrEqual(body.second);
  });

  it('ignores a carrier header that arrived from outside', async () => {
    const front = await startHandler(
      '/api',
      defineEventHandler((event) => ({ remaining: relay.deadline(event)?.remaining ?? null })),
    );
    open.push(front);

    const response = await fetch(`${front.origin}/api`, {
      headers: { [DEADLINE_DEFAULTS.carrier]: String(Date.now() + 999_999) },
    });
    const body = (await response.json()) as { remaining: number };
    expect(body.remaining).toBeLessThanOrEqual(400);
  });

  it('aborts a backend call that would outlive the budget', async () => {
    const backend = await startBackend(() => ({ headers: {}, body: '' }));
    open.push(backend);
    const stuck = new Promise<Response>(() => {});

    const front = await startHandler(
      '/api',
      defineEventHandler(async (event) => {
        const init = relay.forward(event);
        try {
          await Promise.race([
            stuck,
            new Promise((_, reject) =>
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
            ),
          ]);
          return { aborted: false };
        } catch (error) {
          return { aborted: true, reason: (error as Error).name };
        }
      }),
    );
    open.push(front);

    const started = Date.now();
    const body = (await (await fetch(`${front.origin}/api`)).json()) as {
      aborted: boolean;
      reason: string;
    };
    expect(body).toEqual({ aborted: true, reason: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('applies no budget when none is configured', async () => {
    const plain = createRelay({ cookie: { allow: true } });
    const front = await startHandler(
      '/api',
      defineEventHandler((event) => {
        const init = plain.forward(event);
        return {
          header: new Headers(init.headers).get(DEADLINE_DEFAULTS.header),
          view: plain.deadline(event) ?? null,
        };
      }),
    );
    open.push(front);
    expect(await (await fetch(`${front.origin}/api`)).json()).toEqual({ header: null, view: null });
  });
});
