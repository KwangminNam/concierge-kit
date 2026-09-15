import { describe, expect, it } from 'vitest';
import type { RelayContext } from '../context.js';
import { pipeSetCookies, relaySetCookies } from './relaySetCookies.js';

function upstream(...cookies: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { headers });
}

const localhost: RelayContext = { proto: 'http', host: 'dev.example.test:3000' };

describe('relaySetCookies', () => {
  it('relays only what the policy allows and says why the rest was dropped', () => {
    const to = new Headers();
    const result = relaySetCookies(
      upstream('access_token=a; Path=/', 'internal_trace=t; Path=/', 'refresh_token=r; Path=/'),
      to,
      { allow: ['access_token', 'refresh_token'] },
    );

    expect(result.relayed).toEqual(['access_token', 'refresh_token']);
    expect(result.dropped).toEqual([{ name: 'internal_trace', reason: 'not-allowed' }]);
    expect(to.getSetCookie()).toEqual(['access_token=a; Path=/', 'refresh_token=r; Path=/']);
  });

  it('relays nothing at all when no policy is given', () => {
    const to = new Headers();
    const result = relaySetCookies(upstream('a=1', 'b=2'), to);
    expect(result.relayed).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual(['not-allowed', 'not-allowed']);
    expect(to.getSetCookie()).toEqual([]);
  });

  it('keeps two cookies that share a name but differ in Path', () => {
    const to = new Headers();
    const result = relaySetCookies(upstream('sid=one; Path=/app', 'sid=two; Path=/admin'), to, {
      allow: 'sid',
    });
    expect(result.relayed).toEqual(['sid', 'sid']);
    expect(to.getSetCookie()).toEqual(['sid=one; Path=/app', 'sid=two; Path=/admin']);
  });

  it('rewrites for the current environment on the way through', () => {
    const to = new Headers();
    relaySetCookies(
      upstream('access_token=a; Domain=.example.com; Secure; SameSite=None; Partitioned'),
      to,
      { allow: true, domain: 'auto', secure: 'auto', sameSite: 'auto' },
      localhost,
    );
    expect(to.getSetCookie()).toEqual(['access_token=a; SameSite=Lax']);
  });

  it('reports the renamed name as the relayed one', () => {
    const to = new Headers();
    const result = relaySetCookies(upstream('sid=a; Path=/'), to, {
      allow: true,
      rename: { toBrowser: (name) => `web_${name}` },
    });
    expect(result.relayed).toEqual(['web_sid']);
    expect(to.getSetCookie()).toEqual(['web_sid=a; Path=/']);
  });

  it('reports a header it cannot read as a cookie without inventing a name', () => {
    const to = new Headers();
    const from = new Headers();
    from.append('set-cookie', 'this-is-not-a-cookie');
    const result = relaySetCookies(from, to, { allow: true });
    expect(result.dropped).toEqual([{ name: '', reason: 'malformed' }]);
  });

  it('never puts a cookie value in its result', () => {
    const to = new Headers();
    const result = relaySetCookies(upstream('access_token=super-secret; Path=/'), to, {
      allow: true,
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('accepts a bare Headers as the source', () => {
    const from = new Headers();
    from.append('set-cookie', 'a=1');
    const to = new Headers();
    expect(relaySetCookies(from, to, { allow: true }).relayed).toEqual(['a']);
  });
});

describe('pipeSetCookies', () => {
  it('hands each allowed cookie to the sink and reports a refusal as unappliable', () => {
    const written: string[] = [];
    const result = pipeSetCookies(
      upstream('a=1; Path=/', 'b=2; Path=/'),
      ({ raw, name }) => {
        if (name === 'b') return false;
        written.push(raw);
        return true;
      },
      { allow: true },
    );

    expect(written).toEqual(['a=1; Path=/']);
    expect(result.relayed).toEqual(['a']);
    expect(result.dropped).toEqual([{ name: 'b', reason: 'unappliable' }]);
  });
});

describe('headers wrappers that expose a headers field', () => {
  it('treats a wrapper carrying a headers field as headers, not as a response', () => {
    const from = new Headers();
    from.append('set-cookie', 'a=1');
    const wrapped = Object.assign(from, { headers: { unrelated: true } }) as unknown as Headers;

    expect(relaySetCookies(wrapped, new Headers(), { allow: true }).relayed).toEqual(['a']);
  });
});
