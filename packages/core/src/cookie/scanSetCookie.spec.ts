import { describe, expect, it } from 'vitest';
import { findAttribute, scanSetCookie, toSetCookieInfo, valueOf } from './scanSetCookie.js';

describe('scanSetCookie', () => {
  it('locates the name and every attribute by offset', () => {
    const raw = 'sid=abc; Path=/; Domain=.example.com; Secure; SameSite=None';
    const scanned = scanSetCookie(raw)!;
    expect(scanned.name).toBe('sid');
    expect(raw.slice(scanned.nameStart, scanned.nameEnd)).toBe('sid');
    expect(scanned.attributes.map((a) => a.key)).toEqual(['path', 'domain', 'secure', 'samesite']);
    expect(valueOf(raw, findAttribute(scanned, 'domain')!)).toBe('.example.com');
  });

  it('reads a value that itself contains an equals sign', () => {
    const scanned = scanSetCookie('jwt=aa.bb==; Path=/')!;
    expect(scanned.name).toBe('jwt');
  });

  it('does not split on a semicolon inside a quoted value', () => {
    const scanned = scanSetCookie('a="x;y"; Path=/')!;
    expect(scanned.attributes.map((a) => a.key)).toEqual(['path']);
  });

  it('tolerates loose spacing and a trailing semicolon', () => {
    const scanned = scanSetCookie('  sid = abc ;  Secure ; ')!;
    expect(scanned.name).toBe('sid');
    expect(scanned.attributes.map((a) => a.key)).toEqual(['secure']);
  });

  it('refuses a line with no name=value pair', () => {
    expect(scanSetCookie('justtext; Path=/')).toBeNull();
    expect(scanSetCookie('=novalue')).toBeNull();
  });
});

describe('toSetCookieInfo', () => {
  it('describes the cookie without ever exposing its value', () => {
    const scanned = scanSetCookie(
      'sid=secret-value; Path=/app; Domain=.example.com; Secure; HttpOnly; SameSite=None; Partitioned; Priority=High',
    )!;
    const info = toSetCookieInfo(scanned);

    expect(info).toEqual({
      name: 'sid',
      domain: '.example.com',
      path: '/app',
      sameSite: 'none',
      secure: true,
      httpOnly: true,
      attributes: ['path', 'domain', 'secure', 'httponly', 'samesite', 'partitioned', 'priority'],
    });
    expect(JSON.stringify(info)).not.toContain('secret-value');
  });

  it('ignores a SameSite value that is not one of the three legal ones', () => {
    const info = toSetCookieInfo(scanSetCookie('a=1; SameSite=Bogus')!);
    expect(info.sameSite).toBeUndefined();
    expect(info.attributes).toContain('samesite');
  });
});

describe('cookie value offsets', () => {
  it('locates the value without copying it into any description', () => {
    const raw = 'sid=abc.def; Path=/';
    const scanned = scanSetCookie(raw)!;
    expect(raw.slice(scanned.valueStart, scanned.valueEnd)).toBe('abc.def');
  });

  it('locates an empty value', () => {
    const scanned = scanSetCookie('sid=; Path=/')!;
    expect(scanned.valueStart).toBe(scanned.valueEnd);
  });
});
