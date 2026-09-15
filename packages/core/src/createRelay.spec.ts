import { describe, expect, it } from 'vitest';
import { createRelay } from './createRelay.js';

const relay = createRelay({
  cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});

describe('createRelay', () => {
  it('applies the declared policy without repeating it at the call site', () => {
    const upstream = new Response(null, {
      headers: new Headers([
        ['set-cookie', 'access_token=a; Domain=.example.com; Secure'],
        ['set-cookie', 'internal=x'],
      ]),
    });
    const to = new Headers();
    const result = relay.relayCookies(upstream, to, {
      proto: 'http',
      host: 'dev.example.test:3000',
    });

    expect(result.relayed).toEqual(['access_token']);
    expect(result.dropped).toEqual([{ name: 'internal', reason: 'not-allowed' }]);
    expect(to.getSetCookie()).toEqual(['access_token=a']);
  });

  it('forwards the declared cookies', () => {
    const init = relay.forwardCookies(new Headers({ cookie: 'access_token=a; theme=dark' }));
    expect(new Headers(init.headers).get('cookie')).toBe('access_token=a');
  });

  it('prepares upstream headers for the browser', () => {
    const from = new Headers({ 'content-encoding': 'gzip', 'content-type': 'text/html' });
    from.append('set-cookie', 'internal=1');
    const out = relay.prepareHeaders(from);
    expect(out.get('content-encoding')).toBeNull();
    expect(out.getSetCookie()).toEqual([]);
    expect(out.get('content-type')).toBe('text/html');
  });

  it('keeps the options it was built with', () => {
    expect(relay.options.cookie?.allow).toEqual(['access_token']);
  });
});
