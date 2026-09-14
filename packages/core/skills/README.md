# conciergekit, for an AI coding agent

A short operating guide for an agent asked to add, change or migrate conciergekit usage.
The package README is the reference; this is the decision procedure.

## What this package is

A relay for the server layer of a frontend app. In this release it moves cookies in both
directions between the browser and a backend, and nothing else. It is not a proxy, not a fetch
wrapper, and not an auth library.

## Choosing the call

| The call site has                               | Use                                                        |
| ----------------------------------------------- | ---------------------------------------------------------- |
| A `Request` and logic of its own                | `relay.respond(upstream, { request })` in a route handler  |
| Nothing but a target URL                        | `export const POST = relay.route(TARGET)`                  |
| Its own response body plus the backend cookies  | `withRelay(relay, handler)` and `relayFrom(upstream)`      |
| No request object at all, inside `'use server'` | `await relay.forward()` then `await relay.apply(upstream)` |

Prefer the route handler path wherever a response object exists. The cookie store path used by
server actions is keyed by cookie name, so two cookies that share a name collapse into one, and
attributes Next does not model are lost.

## Rules that are not negotiable

1. Never widen `cookie.allow` to `true` to make something work. Name the cookies.
2. Never log, return or snapshot a cookie value. `RelayResult` carries names and reasons only.
3. Never parse a `Set-Cookie` and rebuild it. Rewriting works by splicing the original string,
   which is what keeps `Partitioned`, `Priority` and future attributes alive.
4. Never write headers through a low level Node response. Ending a response by hand can finish
   it before queued `Set-Cookie` headers flush.
5. Never import `next/headers` or `next/server` outside `packages/next/src/framework.ts`.

## Migrating an existing hand rolled relay

Look for these four shapes, which are the usual ones:

- A `set-cookie-parser` call followed by `cookies().set()`. Replace the whole helper with a
  `createRelay` policy. The parse and rebuild is what was dropping attributes.
- A commented out `domain:` or `secure:` line guarded by an `isDeploy()` style check. That is
  what `domain: 'auto'` and `secure: 'auto'` do, judged per request rather than per environment.
- A `method !== 'GET'` guard around cookie writing. It was hiding the render-time restriction by
  accident. Use the route handler path, or `onUnappliable`.
- A hand written list of request headers to forward. Use `forward.cookies` for cookies. General
  header propagation is not in this release; leave the existing code for those and remove only
  the cookie part.

## When something does not reach the browser

Read `RelayResult.dropped`. A `not-allowed` reason means the policy, `unappliable` means the
call happened during a render, and `malformed` means the backend sent something that is not a
cookie. If `relayed` lists the cookie and the browser still does not have it, the attributes are
the suspect: check `domain`, `secure` and `sameSite` against the host actually serving the page,
and remember that testing on `localhost` hides both the `Secure` and the `Domain` failure.
