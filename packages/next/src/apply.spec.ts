import { createRelay } from '@concierge-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from './frameworkMock.js';
import { applyToCookieStore, UnappliableCookieError } from './apply.js';

vi.mock('./framework.js', async () => (await import('./frameworkMock.js')).frameworkMock);

function upstreamWith(...cookies: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { headers });
}

const setCookie = vi.fn<(init: unknown) => void>();

beforeEach(() => {
  setCookie.mockReset();
  state.setCookie = setCookie;
  state.requestHeaders = new Headers();
  vi.restoreAllMocks();
});

const relay = createRelay({ cookie: { allow: ['access_token'] } });

describe('applyToCookieStore', () => {
  it('writes the allowed cookie through the cookie store', async () => {
    const result = await applyToCookieStore(
      upstreamWith('access_token=a; Path=/; HttpOnly; Secure', 'internal=x'),
      relay,
    );

    expect(result.relayed).toEqual(['access_token']);
    expect(setCookie).toHaveBeenCalledTimes(1);
    expect(setCookie).toHaveBeenCalledWith({
      name: 'access_token',
      value: 'a',
      path: '/',
      httpOnly: true,
      secure: true,
    });
  });

  it('carries the attributes Next understands, including Partitioned and Priority', async () => {
    await applyToCookieStore(
      upstreamWith(
        'access_token=a; Path=/; Max-Age=600; SameSite=None; Secure; Partitioned; Priority=High',
      ),
      relay,
    );

    expect(setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAge: 600,
        sameSite: 'none',
        partitioned: true,
        priority: 'high',
      }),
    );
  });

  it('parses an Expires date into the Date the store wants', async () => {
    await applyToCookieStore(
      upstreamWith('access_token=a; Expires=Tue, 21 Oct 2025 07:28:00 GMT'),
      relay,
    );
    const init = setCookie.mock.calls[0]?.[0] as { expires: Date };
    expect(init.expires.toUTCString()).toBe('Tue, 21 Oct 2025 07:28:00 GMT');
  });
});

describe('a cookie store that refuses the write', () => {
  const renderError = new Error(
    'Cookies can only be modified in a Server Action or Route Handler.',
  );

  beforeEach(() => {
    setCookie.mockImplementation(() => {
      throw renderError;
    });
  });

  it('warns by default and reports the cookie as unappliable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await applyToCookieStore(upstreamWith('access_token=a'), relay);

    expect(result.relayed).toEqual([]);
    expect(result.dropped).toEqual([{ name: 'access_token', reason: 'unappliable' }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not write 1 cookie(s)'));
  });

  it('throws when the policy says to, keeping the original error as the cause', async () => {
    const strict = createRelay({ cookie: { allow: true }, onUnappliable: 'throw' });
    await expect(applyToCookieStore(upstreamWith('access_token=a'), strict)).rejects.toThrow(
      UnappliableCookieError,
    );
    await expect(applyToCookieStore(upstreamWith('access_token=a'), strict)).rejects.toMatchObject({
      cookies: ['access_token'],
      cause: renderError,
    });
  });

  it('says nothing when the policy says to ignore it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quiet = createRelay({ cookie: { allow: true }, onUnappliable: 'ignore' });
    const result = await applyToCookieStore(upstreamWith('access_token=a'), quiet);

    expect(result.dropped).toEqual([{ name: 'access_token', reason: 'unappliable' }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets a single call override the relay policy', async () => {
    await expect(
      applyToCookieStore(upstreamWith('access_token=a'), relay, { onUnappliable: 'throw' }),
    ).rejects.toThrow(UnappliableCookieError);
  });

  it('never puts a cookie value in the warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await applyToCookieStore(upstreamWith('access_token=super-secret'), relay);
    expect(warn.mock.calls[0]?.[0]).not.toContain('super-secret');
  });
});
