import { describe, expect, it } from 'vitest';
import { splitSetCookie, splitSetCookieString } from './splitSetCookie.js';

describe('splitSetCookieString', () => {
  it('keeps the comma inside an Expires date attached to its cookie', () => {
    const joined =
      'sid=a; Expires=Wed, 21 Oct 2025 07:28:00 GMT; Path=/, ' +
      'token=b; Expires=Thu, 22 Oct 2025 07:28:00 GMT';
    expect(splitSetCookieString(joined)).toEqual([
      'sid=a; Expires=Wed, 21 Oct 2025 07:28:00 GMT; Path=/',
      'token=b; Expires=Thu, 22 Oct 2025 07:28:00 GMT',
    ]);
  });

  it('splits three cookies', () => {
    expect(splitSetCookieString('a=1; Path=/, b=2; Path=/, c=3')).toEqual([
      'a=1; Path=/',
      'b=2; Path=/',
      'c=3',
    ]);
  });

  it('leaves a comma inside a quoted value alone', () => {
    expect(splitSetCookieString('a="x,y"; Path=/, b=2')).toEqual(['a="x,y"; Path=/', 'b=2']);
  });

  it('returns a single cookie unchanged', () => {
    expect(splitSetCookieString('only=1; HttpOnly')).toEqual(['only=1; HttpOnly']);
  });

  it('returns nothing for an empty string', () => {
    expect(splitSetCookieString('')).toEqual([]);
  });
});

describe('splitSetCookie', () => {
  it('uses getSetCookie when the runtime has it', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    expect(splitSetCookie(headers)).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('falls back to splitting the joined header when getSetCookie is missing', () => {
    const legacy = {
      get: (name: string) =>
        name === 'set-cookie' ? 'a=1; Expires=Wed, 21 Oct 2025 07:28:00 GMT, b=2' : null,
    } as unknown as Headers;
    expect(splitSetCookie(legacy)).toEqual(['a=1; Expires=Wed, 21 Oct 2025 07:28:00 GMT', 'b=2']);
  });

  it('returns nothing when there is no Set-Cookie at all', () => {
    expect(splitSetCookie(new Headers())).toEqual([]);
  });
});
