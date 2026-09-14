import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnings } from '../internal/dev.js';
import { createRelay } from '../createRelay.js';

beforeEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe('development validation', () => {
  it('throws on a policy that could never produce a storable cookie', () => {
    expect(() =>
      createRelay({ cookie: { allow: true, sameSite: 'none', secure: 'strip' } }),
    ).toThrow(/SameSite=None requires Secure/);
  });

  it('warns when no cookie policy was declared at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRelay({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without a cookie policy'));
  });

  it('warns when the allow list is empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRelay({ cookie: { allow: [] } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cookie.allow is empty'));
  });

  it('warns that SameSite None over http will be rejected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRelay({ cookie: { allow: true, sameSite: 'none', secure: 'auto' } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rejected by browsers over plain'));
  });

  it('warns that legacyNames does nothing yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRelay({ cookie: { allow: true, legacyNames: ['old_token'] } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('legacyNames is reserved'));
  });

  it('routes warnings to a supplied logger', () => {
    const logger = { warn: vi.fn() };
    createRelay({ logger, cookie: { allow: [] } });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cookie.allow is empty'));
  });

  it('throws on a misspelled policy key, which TypeScript cannot catch here', () => {
    expect(() => createRelay({ cookie: { allow: true, sameSitePolicy: 'lax' } } as never)).toThrow(
      /unknown cookie policy key: sameSitePolicy/,
    );
  });

  it('throws on a misspelled top level key', () => {
    expect(() => createRelay({ cookies: { allow: true } } as never)).toThrow(
      /unknown createRelay options key: cookies/,
    );
  });

  it('says nothing for a policy with no contradiction', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRelay({ cookie: { allow: ['access_token'] }, forward: { cookies: ['access_token'] } });
    expect(warn).not.toHaveBeenCalled();
  });
});
