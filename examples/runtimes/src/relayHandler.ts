import {
  appendResponseHeader,
  defineEventHandler,
  getRequestHost,
  getRequestProtocol,
  toWebRequest,
  type EventHandler,
} from 'h3';
import {
  forwardRequestCookies,
  pipeSetCookies,
  type CookieRelayPolicy,
  type ForwardPolicy,
} from '@concierge-kit/core';

/**
 * The whole Nuxt and h3 recipe, which is the README example verbatim.
 *
 * There is no `@concierge-kit/h3` package yet, and this is why one is not urgent: h3 already
 * offers `toWebRequest`, and the core speaks nothing but web standards, so the two meet in
 * about fifteen lines.
 *
 * `onUnappliable` has no meaning here. Writing a cookie mid-render is a React Server Component
 * restriction; Nuxt can write response headers during an SSR render.
 */
export function createRelayHandler(options: {
  target: string;
  cookie: CookieRelayPolicy;
  forward?: ForwardPolicy;
}): EventHandler {
  return defineEventHandler(async (event) => {
    const request = toWebRequest(event);
    const context = { proto: getRequestProtocol(event), host: getRequestHost(event) };

    const upstream = await fetch(
      options.target,
      forwardRequestCookies(request, { method: request.method }, options.forward),
    );

    const result = pipeSetCookies(
      upstream,
      ({ raw }) => void appendResponseHeader(event, 'set-cookie', raw),
      options.cookie,
      context,
    );

    return { result, backend: await upstream.json() };
  });
}
