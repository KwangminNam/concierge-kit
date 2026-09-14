import { describe, expect, it } from 'vitest';
import { prepareResponseHeaders, stripHopByHopHeaders } from './hopByHop.js';

describe('stripHopByHopHeaders', () => {
  it('drops the headers that describe the upstream hop', () => {
    const from = new Headers({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': '120',
      'transfer-encoding': 'chunked',
      connection: 'keep-alive',
      'cache-control': 'no-store',
    });
    const out = stripHopByHopHeaders(from);

    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('cache-control')).toBe('no-store');
    expect(out.get('content-encoding')).toBeNull();
    expect(out.get('content-length')).toBeNull();
    expect(out.get('transfer-encoding')).toBeNull();
    expect(out.get('connection')).toBeNull();
  });

  it('does not touch the source headers', () => {
    const from = new Headers({ 'content-encoding': 'gzip' });
    stripHopByHopHeaders(from);
    expect(from.get('content-encoding')).toBe('gzip');
  });

  it('leaves Set-Cookie alone, which is why it is not the passthrough helper', () => {
    const from = new Headers();
    from.append('set-cookie', 'internal=1');
    expect(stripHopByHopHeaders(from).getSetCookie()).toEqual(['internal=1']);
  });
});

describe('prepareResponseHeaders', () => {
  it('drops every Set-Cookie so the allow policy is the only way one gets through', () => {
    const from = new Headers({ 'content-type': 'text/plain', 'content-encoding': 'br' });
    from.append('set-cookie', 'internal_trace=1');
    from.append('set-cookie', 'access_token=a');

    const out = prepareResponseHeaders(from);
    expect(out.getSetCookie()).toEqual([]);
    expect(out.get('content-encoding')).toBeNull();
    expect(out.get('content-type')).toBe('text/plain');
  });
});
