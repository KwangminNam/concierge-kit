import { headersOfRequest } from '../internal/toHeaders.js';
import type { DeadlinePolicy } from '../policy/types.js';

/** A point in time after which this request should stop waiting on anyone. */
export interface Deadline {
  /** Epoch milliseconds. */
  readonly at: number;
}

/** What a call site gets when it asks how much of the budget is left. */
export interface DeadlineView extends Deadline {
  /** Milliseconds left, never negative. */
  readonly remaining: number;
  /** Aborts when the budget runs out. Already aborted if it has. */
  readonly signal: AbortSignal;
}

export const DEADLINE_DEFAULTS = {
  header: 'x-request-deadline',
  carrier: 'x-concierge-deadline',
} as const;

/**
 * Starts the clock. Writes the absolute deadline onto the request headers so every later phase
 * of the same request can read it.
 *
 * Always overwrites: the carrier is an internal contract, and a value arriving from outside
 * must never be trusted as the budget.
 *
 * @see https://concierge-kit.dev/reference/deadline#stampdeadline
 */
export function stampDeadline(
  headers: Headers,
  policy: DeadlinePolicy,
  now: number = Date.now(),
): Deadline {
  const at = now + policy.budget;
  headers.set(policy.carrier ?? DEADLINE_DEFAULTS.carrier, String(at));
  return { at };
}

/**
 * Reads the deadline a previous phase stamped, or `undefined` when this request was never
 * stamped.
 *
 * @see https://concierge-kit.dev/reference/deadline#readdeadline
 */
export function readDeadline(
  from: Request | Headers,
  policy: DeadlinePolicy,
): Deadline | undefined {
  const raw = headersOfRequest(from).get(policy.carrier ?? DEADLINE_DEFAULTS.carrier);
  if (raw === null) return undefined;
  const at = Number(raw);
  return Number.isFinite(at) ? { at } : undefined;
}

/** Milliseconds left on a deadline, clamped at zero. */
export function remainingMs(deadline: Deadline, now: number = Date.now()): number {
  return Math.max(0, Math.ceil(deadline.at - now));
}

/**
 * An `AbortSignal` that fires when the budget runs out. Hand it to `fetch`, or to anything else
 * that takes one.
 *
 * @see https://concierge-kit.dev/reference/deadline#deadlinesignal
 */
export function deadlineSignal(deadline: Deadline, now: number = Date.now()): AbortSignal {
  const remaining = remainingMs(deadline, now);
  if (remaining === 0) {
    return AbortSignal.abort(new DOMException('Request deadline exceeded', 'TimeoutError'));
  }
  return AbortSignal.timeout(remaining);
}

/** Everything a call site wants to know about the budget, computed once. */
export function viewDeadline(deadline: Deadline, now: number = Date.now()): DeadlineView {
  return {
    at: deadline.at,
    remaining: remainingMs(deadline, now),
    signal: deadlineSignal(deadline, now),
  };
}

/**
 * Hands what is left of the budget to one backend call.
 *
 * Two things happen. The call gets an `AbortSignal` so this server stops waiting when the
 * budget is gone, combined with any signal the caller already supplied. And the backend gets a
 * header saying how many milliseconds it has, so it can give up on its own work in time rather
 * than finishing an answer nobody will read.
 *
 * @see https://concierge-kit.dev/reference/deadline#forwarddeadline
 */
export function forwardDeadline(
  init: RequestInit | undefined,
  deadline: Deadline,
  policy: DeadlinePolicy,
  now: number = Date.now(),
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set(policy.header ?? DEADLINE_DEFAULTS.header, String(remainingMs(deadline, now)));

  const own = deadlineSignal(deadline, now);
  const signal = init?.signal ? AbortSignal.any([init.signal, own]) : own;

  return { ...init, headers, signal };
}
