import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE_DEFAULTS } from '../deadline/deadline.js';
import { resetDevWarnings } from '../internal/dev.js';
import { createRelay } from '../createRelay.js';
import {
  ensureRequestId,
  forwardRequestHeaders,
  forwardRequestId,
} from './forwardRequestHeaders.js';

function browser(headers: Record<string, string>): Request {
  return new Request('https://app.example.com/', { headers });
}

beforeEach(() => resetDevWarnings());

describe('forwardRequestHeaders', () => {
  it('forwards only the headers the matcher names, case-insensitively', () => {
    const init = forwardRequestHeaders(
      browser({ 'Accept-Language': 'ko-KR', 'user-agent': 'ua', 'x-secret': 'no' }),
      undefined,
      { headers: ['Accept-Language', 'user-agent'] },
    );
    const out = new Headers(init.headers);
    expect(out.get('accept-language')).toBe('ko-KR');
    expect(out.get('user-agent')).toBe('ua');
    expect(out.get('x-secret')).toBeNull();
  });

  it('accepts a pattern and a predicate', () => {
    const init = forwardRequestHeaders(
      browser({ 'x-trace-id': 't', 'x-trace-span': 's', 'x-other': 'o', accept: 'a' }),
      undefined,
      { headers: [/^x-trace-/, (h) => h.name === 'accept'] },
    );
    const out = new Headers(init.headers);
    expect(out.get('x-trace-id')).toBe('t');
    expect(out.get('x-trace-span')).toBe('s');
    expect(out.get('accept')).toBe('a');
    expect(out.get('x-other')).toBeNull();
  });

  it('never forwards the headers that break the next hop, even under allow-all', () => {
    const init = forwardRequestHeaders(
      browser({
        host: 'app.example.com',
        connection: 'keep-alive',
        'content-length': '99',
        cookie: 'a=1',
        [DEADLINE_DEFAULTS.carrier]: '123',
        'accept-language': 'ko',
      }),
      undefined,
      { headers: true },
    );
    const out = new Headers(init.headers);
    for (const name of [
      'host',
      'connection',
      'content-length',
      'cookie',
      DEADLINE_DEFAULTS.carrier,
    ]) {
      expect(out.get(name)).toBeNull();
    }
    expect(out.get('accept-language')).toBe('ko');
  });

  it('respects a custom deadline carrier in the deny list', () => {
    const init = forwardRequestHeaders(
      browser({ 'x-until': '1' }),
      undefined,
      { headers: true },
      'x-until',
    );
    expect(new Headers(init.headers).get('x-until')).toBeNull();
  });

  it('lets a header the caller set explicitly win', () => {
    const init = forwardRequestHeaders(
      browser({ 'accept-language': 'ko' }),
      { headers: { 'accept-language': 'en' } },
      { headers: true },
    );
    expect(new Headers(init.headers).get('accept-language')).toBe('en');
  });

  it('forwards nothing when no matcher is given', () => {
    const init = forwardRequestHeaders(browser({ 'accept-language': 'ko' }), undefined, {});
    expect(new Headers(init.headers).get('accept-language')).toBeNull();
  });
});

describe('correlation id', () => {
  it('carries the id the browser sent', () => {
    const init = forwardRequestId(browser({ 'x-request-id': 'from-browser' }), undefined, {
      header: 'x-request-id',
    });
    expect(new Headers(init.headers).get('x-request-id')).toBe('from-browser');
  });

  it('mints one when the browser sent none', () => {
    const init = forwardRequestId(browser({}), undefined, {
      header: 'x-request-id',
      generate: () => 'minted',
    });
    expect(new Headers(init.headers).get('x-request-id')).toBe('minted');
  });

  it('mints a uuid by default', () => {
    const init = forwardRequestId(browser({}), undefined, { header: 'x-request-id' });
    expect(new Headers(init.headers).get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not mint over an empty header', () => {
    const init = forwardRequestId(browser({ 'x-request-id': '  ' }), undefined, {
      header: 'x-request-id',
      generate: () => 'minted',
    });
    expect(new Headers(init.headers).get('x-request-id')).toBe('minted');
  });

  it('writes the id onto the request so a later phase reads the same one', () => {
    const headers = new Headers();
    const first = ensureRequestId(headers, { header: 'x-request-id', generate: () => 'once' });
    const second = ensureRequestId(headers, { header: 'x-request-id', generate: () => 'twice' });
    expect(first).toBe('once');
    expect(second).toBe('once');
    expect(headers.get('x-request-id')).toBe('once');
  });
});

describe('through the relay', () => {
  it('applies cookies, headers and the id in one forwardRequest', () => {
    const relay = createRelay({
      cookie: { allow: true },
      forward: {
        cookies: ['access_token'],
        headers: ['accept-language'],
        requestId: { header: 'x-request-id', generate: () => 'gen' },
      },
    });
    const init = relay.forwardRequest(
      browser({ cookie: 'access_token=a; theme=dark', 'accept-language': 'ko', host: 'x' }),
    );
    const out = new Headers(init.headers);
    expect(out.get('cookie')).toBe('access_token=a');
    expect(out.get('accept-language')).toBe('ko');
    expect(out.get('x-request-id')).toBe('gen');
    expect(out.get('host')).toBeNull();
  });

  it('rejects a misspelled forward key and an empty id header', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      createRelay({ cookie: { allow: true }, forward: { header: true } } as never),
    ).toThrow(/unknown forward policy key: header/);
    expect(() =>
      createRelay({ cookie: { allow: true }, forward: { requestId: { header: ' ' } } }),
    ).toThrow(/must name the header/);
  });
});
