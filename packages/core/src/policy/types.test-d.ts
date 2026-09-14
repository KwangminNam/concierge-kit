import { describe, expectTypeOf, it } from 'vitest';
import { createRelay } from '../createRelay.js';
import { relaySetCookies } from '../cookie/relaySetCookies.js';
import type { SetCookieInfo } from './types.js';

describe('matcher narrowing', () => {
  it('narrows relayed names to the literals in allow', () => {
    const result = relaySetCookies(new Headers(), new Headers(), {
      allow: ['access_token', 'refresh_token'],
    });
    expectTypeOf(result.relayed).toEqualTypeOf<Array<'access_token' | 'refresh_token'>>();
  });

  it('narrows a single literal', () => {
    const result = relaySetCookies(new Headers(), new Headers(), { allow: 'sid' });
    expectTypeOf(result.relayed).toEqualTypeOf<'sid'[]>();
  });

  it('widens when a matcher can match anything', () => {
    const result = relaySetCookies(new Headers(), new Headers(), { allow: /^a/ });
    expectTypeOf(result.relayed).toEqualTypeOf<string[]>();
  });

  it('widens when a rename hook decides the emitted name', () => {
    const result = relaySetCookies(new Headers(), new Headers(), {
      allow: ['sid'],
      rename: { toBrowser: (name: string) => name },
    });
    expectTypeOf(result.relayed).toEqualTypeOf<string[]>();
  });

  it('carries the narrowing through a relay instance', () => {
    const relay = createRelay({ cookie: { allow: ['access_token'] } });
    const result = relay.relayCookies(new Headers(), new Headers());
    expectTypeOf(result.relayed).toEqualTypeOf<'access_token'[]>();
  });
});

describe('value secrecy is a type rule, not a convention', () => {
  it('gives a matcher predicate no way to read a cookie value', () => {
    relaySetCookies(new Headers(), new Headers(), {
      allow: (cookie) => {
        expectTypeOf(cookie).toEqualTypeOf<SetCookieInfo>();
        // @ts-expect-error a cookie value is never handed to user code
        return cookie.value === 'x';
      },
    });
  });
});

describe('policy keys are closed', () => {
  it('rejects a rule spelled wrong', () => {
    createRelay({
      // @ts-expect-error 'stripe' is not a domain rule
      cookie: { allow: true, domain: 'stripe' },
    });
  });

  it('rejects a matcher shape that is not a matcher', () => {
    createRelay({
      // @ts-expect-error a number is not a cookie matcher
      cookie: { allow: 42 },
    });
  });
});
