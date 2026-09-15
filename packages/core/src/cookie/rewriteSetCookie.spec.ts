import { describe, expect, it } from 'vitest';
import type { RelayContext } from '../context.js';
import { resolveCookieRules } from '../policy/defaults.js';
import type { CookieRelayPolicy } from '../policy/types.js';
import { rewriteSetCookie } from './rewriteSetCookie.js';
import { scanSetCookie, toSetCookieInfo } from './scanSetCookie.js';

function rewrite(raw: string, policy?: Partial<CookieRelayPolicy>, ctx?: RelayContext): string {
  const scanned = scanSetCookie(raw)!;
  const rules = resolveCookieRules({ allow: true, ...policy });
  return rewriteSetCookie(scanned, toSetCookieInfo(scanned), rules, ctx);
}

const https: RelayContext = { proto: 'https', host: 'app.example.com' };
const localhost: RelayContext = { proto: 'http', host: 'dev.example.test:3000' };

describe('attribute preservation', () => {
  it('leaves attributes it does not know about byte for byte', () => {
    const raw = 'sid=abc; Path=/; Partitioned; Priority=High; Max-Age=3600; HttpOnly';
    expect(rewrite(raw, { domain: 'keep', secure: 'keep', sameSite: 'keep' })).toBe(raw);
  });

  it('keeps Partitioned and Priority while stripping Domain', () => {
    const out = rewrite('sid=abc; Domain=.example.com; Partitioned; Priority=High', {
      domain: 'strip',
    });
    expect(out).toBe('sid=abc; Partitioned; Priority=High');
  });

  it('keeps an Expires date intact', () => {
    const raw = 'sid=abc; Expires=Wed, 21 Oct 2025 07:28:00 GMT; Domain=.example.com';
    expect(rewrite(raw, { domain: 'strip' })).toBe(
      'sid=abc; Expires=Wed, 21 Oct 2025 07:28:00 GMT',
    );
  });

  it('keeps a quoted value intact', () => {
    expect(rewrite('a="x;y"; Domain=.example.com', { domain: 'strip' })).toBe('a="x;y"');
  });
});

describe('domain', () => {
  it('keeps a domain the current host can match', () => {
    expect(rewrite('sid=a; Domain=.example.com', { domain: 'auto' }, https)).toBe(
      'sid=a; Domain=.example.com',
    );
  });

  it('strips a domain the current host cannot match', () => {
    expect(rewrite('sid=a; Domain=.example.com', { domain: 'auto' }, localhost)).toBe('sid=a');
  });

  it('keeps the domain when there is no context to judge with', () => {
    expect(rewrite('sid=a; Domain=.example.com', { domain: 'auto' })).toBe(
      'sid=a; Domain=.example.com',
    );
  });

  it('replaces the domain from a function', () => {
    expect(rewrite('sid=a; Domain=.example.com', { domain: () => 'dev.local' })).toBe(
      'sid=a; Domain=dev.local',
    );
  });

  it('adds a domain that was not there when a function asks for one', () => {
    expect(rewrite('sid=a; Path=/', { domain: () => 'dev.local' })).toBe(
      'sid=a; Path=/; Domain=dev.local',
    );
  });

  it('treats undefined from a function as leave it alone', () => {
    expect(rewrite('sid=a; Domain=.example.com', { domain: () => undefined })).toBe(
      'sid=a; Domain=.example.com',
    );
  });
});

describe('secure and samesite', () => {
  it('strips Secure over plain http and downgrades SameSite None to Lax', () => {
    expect(
      rewrite('sid=a; Secure; SameSite=None', { secure: 'auto', sameSite: 'auto' }, localhost),
    ).toBe('sid=a; SameSite=Lax');
  });

  it('keeps Secure and SameSite None over https', () => {
    const raw = 'sid=a; Secure; SameSite=None';
    expect(rewrite(raw, { secure: 'auto', sameSite: 'auto' }, https)).toBe(raw);
  });

  it('does not downgrade SameSite Lax when Secure is stripped', () => {
    expect(rewrite('sid=a; Secure; SameSite=Lax', { secure: 'strip', sameSite: 'auto' })).toBe(
      'sid=a; SameSite=Lax',
    );
  });

  it('adds Secure when forced', () => {
    expect(rewrite('sid=a; Path=/', { secure: 'force' })).toBe('sid=a; Path=/; Secure');
  });

  it('overwrites SameSite with an explicit value', () => {
    expect(rewrite('sid=a; SameSite=None; Secure', { sameSite: 'lax' })).toBe(
      'sid=a; SameSite=Lax; Secure',
    );
  });

  it('adds SameSite when the upstream cookie had none', () => {
    expect(rewrite('sid=a; Path=/', { sameSite: 'strict' })).toBe('sid=a; Path=/; SameSite=Strict');
  });
});

describe('path and rename', () => {
  it('overwrites Path', () => {
    expect(rewrite('sid=a; Path=/api', { path: '/' })).toBe('sid=a; Path=/');
  });

  it('renames the cookie without touching its value', () => {
    expect(rewrite('sid=abc; Path=/', { rename: { toBrowser: (n) => `web_${n}` } })).toBe(
      'web_sid=abc; Path=/',
    );
  });
});

describe('secure context', () => {
  const loopback: RelayContext = { proto: 'http', host: 'localhost:3000' };

  it('keeps Secure on localhost, where the browser stores it over http anyway', () => {
    const raw = 'sid=a; Secure; SameSite=None; Partitioned';
    expect(rewrite(raw, { secure: 'auto', sameSite: 'auto' }, loopback)).toBe(raw);
  });

  it.each(['127.0.0.1:3000', 'app.localhost', '[::1]:3000'])('treats %s as loopback', (host) => {
    expect(rewrite('sid=a; Secure', { secure: 'auto' }, { proto: 'http', host })).toBe(
      'sid=a; Secure',
    );
  });

  it('strips Partitioned along with Secure, since one cannot exist without the other', () => {
    expect(
      rewrite(
        'sid=a; Secure; SameSite=None; Partitioned; HttpOnly',
        { secure: 'auto', sameSite: 'auto' },
        {
          proto: 'http',
          host: 'dev.example.test',
        },
      ),
    ).toBe('sid=a; SameSite=Lax; HttpOnly');
  });

  it('leaves a __Host- cookie alone rather than make it invalid', () => {
    const raw = '__Host-sid=a; Path=/; Secure';
    expect(rewrite(raw, { secure: 'auto' }, { proto: 'http', host: 'dev.example.test' })).toBe(raw);
  });

  it('still strips an explicit request, prefix or not', () => {
    expect(rewrite('__Secure-x=1; Secure', { secure: 'strip' })).toBe('__Secure-x=1');
  });
});
