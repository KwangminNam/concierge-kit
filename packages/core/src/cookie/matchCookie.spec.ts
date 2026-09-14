import { describe, expect, it } from 'vitest';
import type { SetCookieInfo } from '../policy/types.js';
import { matchCookie } from './matchCookie.js';

const info = (name: string): SetCookieInfo => ({
  name,
  secure: true,
  httpOnly: true,
  attributes: ['secure', 'httponly'],
});

describe('matchCookie', () => {
  it('relays nothing when no matcher is given', () => {
    expect(matchCookie(info('a'), undefined)).toBe(false);
  });

  it('accepts a boolean', () => {
    expect(matchCookie(info('a'), true)).toBe(true);
    expect(matchCookie(info('a'), false)).toBe(false);
  });

  it('accepts an exact name', () => {
    expect(matchCookie(info('access_token'), 'access_token')).toBe(true);
    expect(matchCookie(info('access_token2'), 'access_token')).toBe(false);
  });

  it('accepts a pattern', () => {
    expect(matchCookie(info('access_token'), /_token$/)).toBe(true);
    expect(matchCookie(info('session'), /_token$/)).toBe(false);
  });

  it('does not let a global pattern go stale between calls', () => {
    const pattern = /token/g;
    expect(matchCookie(info('token'), pattern)).toBe(true);
    expect(matchCookie(info('token'), pattern)).toBe(true);
  });

  it('accepts a predicate that never sees a value', () => {
    expect(matchCookie(info('a'), (cookie) => cookie.secure)).toBe(true);
    expect(matchCookie(info('a'), (cookie) => 'value' in cookie)).toBe(false);
  });

  it('combines an array with OR', () => {
    const matcher = ['refresh_token', /^access_/, (c: SetCookieInfo) => c.name === 'csrf'];
    expect(matchCookie(info('refresh_token'), matcher)).toBe(true);
    expect(matchCookie(info('access_token'), matcher)).toBe(true);
    expect(matchCookie(info('csrf'), matcher)).toBe(true);
    expect(matchCookie(info('internal'), matcher)).toBe(false);
  });

  it('matches nothing for an empty array', () => {
    expect(matchCookie(info('a'), [])).toBe(false);
  });
});
