import {
  pipeSetCookies,
  type Relay,
  type RelayContext,
  type RelayResult,
} from '@concierge-kit/core';
import type { H3Event } from 'h3';
import { appendSetCookie, toContext } from './framework.js';

/** Options for {@link applyToEvent}. */
export interface ApplyOptions {
  /** Request information for the `'auto'` rules. Read from the event when absent. */
  readonly context?: RelayContext;
}

/**
 * Relays the allowed cookies of a backend response onto the response h3 is building, and
 * leaves status and body to you.
 *
 * Use this when the handler returns its own payload. Use {@link respondWithUpstream} to pass the
 * backend answer through untouched.
 *
 * Cookies are appended as the raw headers the backend sent, so two cookies that share a name but
 * differ in `Path` both survive and unknown attributes survive with them. There is no cookie
 * store path here and no `onUnappliable`: writing a cookie mid-render is a React Server
 * Component restriction, and h3 can always write a response header.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
 *   const result = relay.apply(event, upstream);
 *   return { ok: upstream.ok, relayed: result.relayed };
 * });
 * ```
 *
 * @see https://concierge-kit.dev/reference/h3#apply
 */
export function applyToEvent(
  relay: Relay,
  event: H3Event,
  upstream: Response | Headers,
  options?: ApplyOptions,
): RelayResult {
  return pipeSetCookies(
    upstream,
    ({ raw }) => void appendSetCookie(event, raw),
    relay.options.cookie,
    options?.context ?? toContext(event),
  );
}
