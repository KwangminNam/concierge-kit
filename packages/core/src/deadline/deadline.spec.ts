import { describe, expect, it } from 'vitest';
import {
  DEADLINE_DEFAULTS,
  deadlineSignal,
  forwardDeadline,
  readDeadline,
  remainingMs,
  stampDeadline,
  viewDeadline,
} from './deadline.js';

const policy = { budget: 3000 };
const T0 = 1_700_000_000_000;

describe('stamp and read', () => {
  it('writes an absolute deadline the next phase can read back', () => {
    const headers = new Headers();
    const stamped = stampDeadline(headers, policy, T0);

    expect(stamped.at).toBe(T0 + 3000);
    expect(headers.get(DEADLINE_DEFAULTS.carrier)).toBe(String(T0 + 3000));
    expect(readDeadline(headers, policy)).toEqual({ at: T0 + 3000 });
  });

  it('overwrites a value that arrived from outside, which must never be trusted', () => {
    const headers = new Headers({ [DEADLINE_DEFAULTS.carrier]: '99999999999999' });
    stampDeadline(headers, policy, T0);
    expect(readDeadline(headers, policy)?.at).toBe(T0 + 3000);
  });

  it('reads from a Request as well as from Headers', () => {
    const headers = new Headers();
    stampDeadline(headers, policy, T0);
    const request = new Request('https://app.example.com/', { headers });
    expect(readDeadline(request, policy)?.at).toBe(T0 + 3000);
  });

  it('reports no deadline when nothing was stamped or the stamp is garbage', () => {
    expect(readDeadline(new Headers(), policy)).toBeUndefined();
    expect(
      readDeadline(new Headers({ [DEADLINE_DEFAULTS.carrier]: 'soon' }), policy),
    ).toBeUndefined();
  });

  it('honours a custom carrier header', () => {
    const custom = { budget: 100, carrier: 'x-budget-until' };
    const headers = new Headers();
    stampDeadline(headers, custom, T0);
    expect(headers.get('x-budget-until')).toBe(String(T0 + 100));
    expect(headers.get(DEADLINE_DEFAULTS.carrier)).toBeNull();
  });
});

describe('remaining budget', () => {
  it('counts down from the stamp', () => {
    expect(remainingMs({ at: T0 + 3000 }, T0 + 2100)).toBe(900);
  });

  it('never goes below zero', () => {
    expect(remainingMs({ at: T0 }, T0 + 5000)).toBe(0);
  });

  it('gives a signal that is already aborted once the budget is gone', () => {
    const signal = deadlineSignal({ at: T0 }, T0 + 1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
  });

  it('gives a live signal while budget remains', () => {
    const signal = deadlineSignal({ at: T0 + 3000 }, T0);
    expect(signal.aborted).toBe(false);
  });

  it('bundles the numbers and the signal into one view', () => {
    const view = viewDeadline({ at: T0 + 3000 }, T0 + 1000);
    expect(view).toMatchObject({ at: T0 + 3000, remaining: 2000 });
    expect(view.signal.aborted).toBe(false);
  });
});

describe('forwardDeadline', () => {
  it('tells the backend how long it has, relative to now', () => {
    const init = forwardDeadline({ method: 'POST' }, { at: T0 + 3000 }, policy, T0 + 2100);
    expect(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)).toBe('900');
    expect(init.method).toBe('POST');
    expect(init.signal?.aborted).toBe(false);
  });

  it('honours a custom outbound header name', () => {
    const init = forwardDeadline(
      undefined,
      { at: T0 + 500 },
      { budget: 500, header: 'grpc-timeout' },
      T0,
    );
    expect(new Headers(init.headers).get('grpc-timeout')).toBe('500');
  });

  it('keeps the caller other headers', () => {
    const init = forwardDeadline(
      { headers: { 'content-type': 'application/json' } },
      { at: T0 + 100 },
      policy,
      T0,
    );
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('combines with a signal the caller already had, so either can abort', () => {
    const own = new AbortController();
    const init = forwardDeadline({ signal: own.signal }, { at: T0 + 3000 }, policy, T0);

    expect(init.signal?.aborted).toBe(false);
    own.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('hands an exhausted budget on as an already aborted call', () => {
    const init = forwardDeadline(undefined, { at: T0 }, policy, T0 + 10);
    expect(new Headers(init.headers).get(DEADLINE_DEFAULTS.header)).toBe('0');
    expect(init.signal?.aborted).toBe(true);
  });

  it('actually stops a fetch that would outlive the budget', async () => {
    const init = forwardDeadline(undefined, { at: Date.now() + 30 }, policy);
    const never = new Promise<Response>(() => {});
    const raced = Promise.race([
      never,
      new Promise<never>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      ),
    ]);
    await expect(raced).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
