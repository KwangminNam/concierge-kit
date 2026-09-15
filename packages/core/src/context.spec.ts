import { describe, expect, it } from 'vitest';
import { domainMatches, isLoopbackHost, normalizeHost, resolveRelayContext } from './context.js';

describe('resolveRelayContext', () => {
  it('trusts the forwarded proto over the request url', () => {
    const request = new Request('http://internal-svc:3000/api', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.com' },
    });
    expect(resolveRelayContext(request)).toEqual({ proto: 'https', host: 'app.example.com' });
  });

  it('takes the first entry of a forwarded chain', () => {
    const request = new Request('http://internal/', {
      headers: { 'x-forwarded-proto': 'https, http' },
    });
    expect(resolveRelayContext(request)?.proto).toBe('https');
  });

  it('falls back to the request url when there are no proxy headers', () => {
    expect(resolveRelayContext(new Request('https://app.example.com/x'))).toEqual({
      proto: 'https',
      host: 'app.example.com',
    });
  });

  it('reads a bare Headers when there is no request object', () => {
    const headers = new Headers({ host: 'localhost:3000', 'x-forwarded-proto': 'http' });
    expect(resolveRelayContext(headers)).toEqual({ proto: 'http', host: 'localhost:3000' });
  });

  it('returns nothing when the headers say nothing', () => {
    expect(resolveRelayContext(new Headers())).toBeUndefined();
  });
});

describe('domainMatches', () => {
  it('matches a host against its own domain and subdomains', () => {
    expect(domainMatches('app.example.com', '.example.com')).toBe(true);
    expect(domainMatches('example.com', 'example.com')).toBe(true);
    expect(domainMatches('app.example.com:3000', 'example.com')).toBe(true);
  });

  it('rejects a host that only looks similar', () => {
    expect(domainMatches('localhost', '.example.com')).toBe(false);
    expect(domainMatches('notexample.com', 'example.com')).toBe(false);
    expect(domainMatches('dev.example.test', '.example.com')).toBe(false);
  });
});

describe('normalizeHost', () => {
  it('drops the port and lowercases', () => {
    expect(normalizeHost('App.Example.COM:3000')).toBe('app.example.com');
  });

  it('keeps a bracketed ipv6 literal whole', () => {
    expect(normalizeHost('[::1]:3000')).toBe('[::1]');
  });
});

describe('isLoopbackHost', () => {
  it('recognises every form browsers grant a secure context to', () => {
    for (const host of [
      'localhost',
      'localhost:3000',
      'api.localhost',
      '127.0.0.1',
      '127.1.2.3:80',
      '[::1]:3000',
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('rejects everything else, including hosts that merely resolve to loopback', () => {
    for (const host of ['dev.example.test', '128.0.0.1', 'localhost.example.com', '0.0.0.0']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});
