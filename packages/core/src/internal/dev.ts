import type { RelayLogger } from '../policy/types.js';

/**
 * True outside production builds. Every validation and warning in concierge-kit is guarded by
 * this, so production pays nothing for them.
 */
export function isDev(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

const seen = new Set<string>();

/** Warns once per key, so a hot request path cannot flood the log. */
export function devWarnOnce(logger: RelayLogger | undefined, key: string, message: string): void {
  if (!isDev() || seen.has(key)) return;
  seen.add(key);
  (logger ?? console).warn(`[concierge-kit] ${message}`);
}

/** Test-only hook. Lets a spec assert on a warning that another spec already triggered. */
export function resetDevWarnings(): void {
  seen.clear();
}
