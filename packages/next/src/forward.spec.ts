import { createRelay } from '@concierge-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from './frameworkMock.js';
import { forwardFromRequest } from './forward.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

const relay = createRelay({ cookie: { allow: true }, forward: { cookies: ['access_token'] } });

beforeEach(() => {
  state.requestHeaders = new Headers();
});

describe('forwardFromRequest', () => {
  it('reads the ambient request when no request object is in hand', async () => {
    state.requestHeaders = new Headers({ cookie: 'access_token=a; theme=dark' });
    const init = await forwardFromRequest(relay, undefined, { method: 'POST' });

    expect(new Headers(init.headers).get('cookie')).toBe('access_token=a');
    expect(init.method).toBe('POST');
  });

  it('prefers an explicit request over the ambient one', async () => {
    state.requestHeaders = new Headers({ cookie: 'access_token=ambient' });
    const init = await forwardFromRequest(
      relay,
      new Request('https://app.example.com/x', { headers: { cookie: 'access_token=explicit' } }),
    );
    expect(new Headers(init.headers).get('cookie')).toBe('access_token=explicit');
  });
});
