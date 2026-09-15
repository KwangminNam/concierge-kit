import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE_DEFAULTS, stampDeadline } from './deadline/deadline.js';
import { forwardRequest } from './forwardRequest.js';
import { resetDevWarnings } from './internal/dev.js';
import { createRelay } from './createRelay.js';

const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe('forwardRequest', () => {
  it('applies cookies and the deadline together', () => {
    const headers = new Headers({ cookie: 'access_token=a; theme=dark' });
    stampDeadline(headers, { budget: 3000 }, T0);

    const init = forwardRequest(
      headers,
      { method: 'POST' },
      {
        forward: { cookies: ['access_token'] },
        deadline: { budget: 3000 },
      },
      T0 + 1000,
    );

    const out = new Headers(init.headers);
    expect(out.get('cookie')).toBe('access_token=a');
    expect(out.get(DEADLINE_DEFAULTS.header)).toBe('2000');
    expect(init.method).toBe('POST');
    expect(init.signal?.aborted).toBe(false);
  });

  it('does only cookies when no deadline is configured', () => {
    const init = forwardRequest(new Headers({ cookie: 'a=1' }), undefined, {
      forward: { cookies: true },
    });
    expect(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)).toBeNull();
    expect(init.signal).toBeUndefined();
  });

  it('warns once, and applies no budget, when the request was never stamped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const init = forwardRequest(new Headers(), undefined, { deadline: { budget: 3000 } });
    forwardRequest(new Headers(), undefined, { deadline: { budget: 3000 } });

    expect(init.signal).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('never stamped');
  });
});

describe('relay.forwardRequest and relay.deadlineOf', () => {
  const relay = createRelay({
    cookie: { allow: true },
    forward: { cookies: true },
    deadline: { budget: 2000 },
  });

  it('reads what is left of the budget for a call site that wants the signal itself', () => {
    const headers = new Headers();
    stampDeadline(headers, { budget: 2000 }, Date.now() - 500);

    const view = relay.deadlineOf(headers);
    expect(view?.remaining).toBeGreaterThan(1000);
    expect(view?.remaining).toBeLessThanOrEqual(1500);
    expect(view?.signal.aborted).toBe(false);
  });

  it('reports no budget when the request was never stamped', () => {
    expect(relay.deadlineOf(new Headers())).toBeUndefined();
  });

  it('reports no budget when no deadline policy exists', () => {
    const plain = createRelay({ cookie: { allow: true } });
    expect(plain.deadlineOf(new Headers())).toBeUndefined();
  });
});

describe('deadline policy validation', () => {
  it('rejects a budget that is not a positive number', () => {
    expect(() => createRelay({ cookie: { allow: true }, deadline: { budget: 0 } })).toThrow(
      /positive/,
    );
    expect(() =>
      createRelay({ cookie: { allow: true }, deadline: { budget: Number.NaN } }),
    ).toThrow(/positive/);
  });

  it('rejects a misspelled deadline key', () => {
    expect(() =>
      createRelay({ cookie: { allow: true }, deadline: { budget: 100, timeout: 5 } } as never),
    ).toThrow(/unknown deadline policy key: timeout/);
  });
});
