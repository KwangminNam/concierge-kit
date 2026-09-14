import { describe, expect, it } from 'vitest';
import { toCookieStoreInit } from './cookieStoreInit.js';

describe('toCookieStoreInit', () => {
  it('maps every attribute Next models', () => {
    expect(
      toCookieStoreInit(
        'sid=abc; Path=/app; Domain=.example.com; Max-Age=60; HttpOnly; Secure; SameSite=Lax; Partitioned; Priority=Medium',
      ),
    ).toEqual({
      name: 'sid',
      value: 'abc',
      path: '/app',
      domain: '.example.com',
      maxAge: 60,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      partitioned: true,
      priority: 'medium',
    });
  });

  it('loses an attribute Next has no field for, which is the cost of this path', () => {
    const init = toCookieStoreInit('sid=abc; Path=/; SomeFutureAttribute=1');
    expect(init).toEqual({ name: 'sid', value: 'abc', path: '/' });
  });

  it('keeps a value that contains an equals sign', () => {
    expect(toCookieStoreInit('jwt=aa.bb==; Path=/')?.value).toBe('aa.bb==');
  });

  it('ignores an unreadable Expires rather than sending an invalid date', () => {
    expect(toCookieStoreInit('sid=a; Expires=not-a-date')).toEqual({ name: 'sid', value: 'a' });
  });

  it('refuses a line that is not a cookie', () => {
    expect(toCookieStoreInit('nonsense')).toBeNull();
  });
});
