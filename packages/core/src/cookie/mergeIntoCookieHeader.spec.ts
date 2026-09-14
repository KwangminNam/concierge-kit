import { describe, expect, it } from 'vitest';
import { mergeIntoCookieHeader, removeFromCookieHeader } from './mergeIntoCookieHeader.js';
import { literalCookieNames } from './matchCookie.js';

describe('mergeIntoCookieHeader', () => {
  it('replaces the value of a cookie the request already carried', () => {
    expect(
      mergeIntoCookieHeader('access_token=stale; theme=dark', ['access_token=fresh; Path=/']),
    ).toBe('access_token=fresh; theme=dark');
  });

  it('adds a cookie the request did not carry', () => {
    expect(mergeIntoCookieHeader('theme=dark', ['access_token=fresh; Path=/'])).toBe(
      'theme=dark; access_token=fresh',
    );
  });

  it('works from an absent header', () => {
    expect(mergeIntoCookieHeader(null, ['access_token=fresh'])).toBe('access_token=fresh');
  });

  it('removes a cookie being deleted by Max-Age', () => {
    expect(
      mergeIntoCookieHeader('access_token=stale; theme=dark', ['access_token=; Max-Age=0']),
    ).toBe('theme=dark');
  });

  it('removes a cookie being deleted by an Expires in the past', () => {
    expect(
      mergeIntoCookieHeader('access_token=stale', [
        'access_token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ]),
    ).toBe('');
  });

  it('keeps a cookie whose Expires is still ahead', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    expect(mergeIntoCookieHeader('a=1', [`a=2; Expires=${future}`])).toBe('a=2');
  });

  it('lets a later line win over an earlier one', () => {
    expect(mergeIntoCookieHeader(null, ['a=first', 'a=second'])).toBe('a=second');
  });

  it('keeps a value that contains an equals sign', () => {
    expect(mergeIntoCookieHeader(null, ['jwt=aa.bb==; Path=/'])).toBe('jwt=aa.bb==');
  });

  it('ignores a line that is not a cookie', () => {
    expect(mergeIntoCookieHeader('a=1', ['nonsense'])).toBe('a=1');
  });

  it('preserves the order of the cookies already present', () => {
    expect(mergeIntoCookieHeader('a=1; b=2; c=3', ['b=9'])).toBe('a=1; b=9; c=3');
  });
});

describe('removeFromCookieHeader', () => {
  it('drops the named cookies and keeps the rest', () => {
    expect(
      removeFromCookieHeader('access_token=a; theme=dark; refresh_token=r', [
        'access_token',
        'refresh_token',
      ]),
    ).toBe('theme=dark');
  });

  it('returns an empty header when everything went', () => {
    expect(removeFromCookieHeader('a=1', ['a'])).toBe('');
  });
});

describe('literalCookieNames', () => {
  it('takes the names a matcher states outright', () => {
    expect(literalCookieNames(['access_token', /^x/, 'refresh_token'])).toEqual([
      'access_token',
      'refresh_token',
    ]);
  });

  it('finds nothing in a matcher that names nothing', () => {
    expect(literalCookieNames(true)).toEqual([]);
    expect(literalCookieNames(/^a/)).toEqual([]);
    expect(literalCookieNames(undefined)).toEqual([]);
  });
});
