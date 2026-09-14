import { AsyncLocalStorage } from 'node:async_hooks';
import type { RelayContext } from '../context.js';

/**
 * What a relay needs to know about the request in flight when no `Request` object is in hand.
 */
export interface RelayRequestSnapshot {
  readonly headers: Headers;
  readonly context?: RelayContext;
}

const storage = new AsyncLocalStorage<RelayRequestSnapshot>();

/**
 * Runs `fn` with a request snapshot attached to the async context.
 *
 * Only needed on runtimes that offer no way to read the current request, such as a custom
 * server or h3. The Next.js adapter reads `headers()` instead and never touches this.
 *
 * Lives under the `/node` subpath because `AsyncLocalStorage` does not exist on Edge, and
 * importing it from the main entry would break an Edge bundle that never even calls it.
 *
 * @see https://conciergekit.dev/reference/node#runwithrequest
 */
export function runWithRequest<T>(snapshot: RelayRequestSnapshot, fn: () => T): T {
  return storage.run(snapshot, fn);
}

/**
 * The snapshot for the request in flight, or `undefined` outside {@link runWithRequest}.
 *
 * @see https://conciergekit.dev/reference/node#getrequestsnapshot
 */
export function getRequestSnapshot(): RelayRequestSnapshot | undefined {
  return storage.getStore();
}
