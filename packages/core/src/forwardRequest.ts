import { forwardRequestCookies } from './cookie/forwardRequestCookies.js';
import { forwardDeadline, readDeadline } from './deadline/deadline.js';
import { devWarnOnce } from './internal/dev.js';
import type { DeadlinePolicy, ForwardPolicy, RelayLogger } from './policy/types.js';

/** The rules {@link forwardRequest} applies. Each is optional and independent. */
export interface ForwardRules {
  readonly forward?: ForwardPolicy;
  readonly deadline?: DeadlinePolicy;
  readonly logger?: RelayLogger;
}

/**
 * Builds the `RequestInit` for a backend call, applying every configured forward rule.
 *
 * Today that is the browser's allowed cookies and what is left of the request's time budget.
 * Request header propagation will join them here, which is why this exists apart from
 * `forwardRequestCookies`: one call site, growing rules.
 *
 * A deadline policy on a request that was never stamped is reported once in development and
 * otherwise ignored, so a missing proxy degrades to "no budget" rather than to a crash.
 *
 * @see https://concierge-kit.dev/reference/forward
 */
export function forwardRequest(
  from: Request | Headers,
  init: RequestInit | undefined,
  rules: ForwardRules,
  now: number = Date.now(),
): RequestInit {
  let next = forwardRequestCookies(from, init, rules.forward);

  if (rules.deadline !== undefined) {
    const deadline = readDeadline(from, rules.deadline);
    if (deadline === undefined) {
      devWarnOnce(
        rules.logger,
        'deadline-not-stamped',
        'A deadline is configured but this request was never stamped, so no budget was ' +
          'applied. Stamp it where the request enters: relay.proxy() in Next.js does this.',
      );
    } else {
      next = forwardDeadline(next, deadline, rules.deadline, now);
    }
  }

  return next;
}
