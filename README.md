# concierge-kit

**English** · [한국어](./README.ko.md)

A relay for the server layer of a frontend app. The concierge deals with the backend so your
handlers do not have to.

Next.js App Router and Nuxt both let the frontend call a backend from their own server runtime.
Every project that does it writes the same plumbing by hand, gets one attribute wrong, and
watches a cookie disappear without an error. This package is that plumbing, declared once.

## Before and after

### Before

Three files, about forty lines, and a cookie that vanishes without an error message.

```ts
// setCookieFromApi.ts
import { cookies } from 'next/headers';
import setCookieParser from 'set-cookie-parser';

export async function setCookieFromApi(setCookieList: string[]) {
  if (setCookieList.length === 0) return;
  const parsed = setCookieList.map((s) => setCookieParser.parse(s)[0]); // (1) attributes lost here
  await Promise.all(
    parsed.map(async (cookie) => {
      const store = await cookies();
      store.set({
        // (2) keyed by name, so one cookie overwrites another
        ...cookie,
        // domain: isDeploy() ? cookie.domain : undefined,   // (3) gave up, left commented
        // secure: isDeploy() ? cookie.secure : false,
        sameSite: cookie.sameSite as 'lax' | 'strict' | 'none' | undefined,
      });
    }),
  );
}

// getRequestHeaders.ts
const REQUIRED_HEADERS = ['cookie'];
export async function getRequestHeaders() {
  return [...(await headers()).entries()]
    .filter(([k]) => REQUIRED_HEADERS.includes(k))
    .reduce((acc, [k, v]) => Object.assign(acc, { [k]: v }), {});
}

// FetchClient.ts
const res = await fetch(fullURL, { ...options, headers: await getRequestHeaders() });
if (options.method !== 'GET') {
  // (4) a guard that happens to hide a crash
  await setCookieFromApi(res.headers.getSetCookie()); // (5) no allow list: everything gets through
}
```

### After

One file declares the policy. Call sites are one line.

```ts
// lib/relay.ts
import { createRelay } from '@concierge-kit/next';

export const relay = createRelay({
  cookie: {
    allow: ['access_token', 'refresh_token'],
    domain: 'auto',
    secure: 'auto',
    sameSite: 'auto',
  },
  forward: { cookies: ['access_token', 'refresh_token'] },
});
```

```ts
// app/api/login/route.ts
export async function POST(request: Request) {
  const upstream = await fetch(
    `${API}/login`,
    await relay.forward(request, { method: 'POST', body: request.body }),
  );
  return relay.respond(upstream);
}
```

### What each of those numbers was costing you

|     | What went wrong before                                                                                      | What you saw                                                                                      | What happens now                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| (1) | The cookie was parsed into an object and baked again, so any attribute the parser did not model was dropped | `Partitioned` and `Priority` silently missing, and CHIPS quietly broken                           | The original string is spliced, so attributes the code has never heard of pass through byte for byte                            |
| (2) | The framework cookie store is keyed by name                                                                 | Two cookies sharing a name but differing in `Path` collapsed into one                             | Cookies are appended as raw headers, so both survive                                                                            |
| (3) | Environment differences were never solved, just commented out                                               | `Domain=.example.com` on localhost, `Secure` over http: the browser discarded them without a word | `domain: 'auto'` and `secure: 'auto'` judge per request, and only ever remove an attribute that would have caused the rejection |
| (4) | `method !== 'GET'` was hiding the fact that Next throws when a cookie is set during a render                | Worked by luck. The first `GET` that needed a cookie would crash                                  | Route handlers write to the response, and `onUnappliable` turns a render-time write into a reported drop instead of a crash     |
| (5) | Every cookie the backend set reached the browser                                                            | An internal backend cookie leaking to the client, unnoticed                                       | `allow` is required, nothing is relayed by default, and a wrong key throws in development                                       |
| all | There was no way to know what actually happened                                                             | Debugging by reading response headers by hand                                                     | Every call returns `{ relayed, dropped }` with names and reasons. Never values                                                  |

What disappears from the call site is the method branch, the environment branch, the parsing
dependency and the header-collecting helper. What appears is an answer to "did it actually go
through, and if not, why".

## Why a cookie disappears

A server `fetch` has no cookie jar. When your server calls the backend, that is a second HTTP
transaction the browser knows nothing about, so the backend's `Set-Cookie` lands on a response
object inside your server and is thrown away. The other direction is not automatic either: the
browser's cookies do not travel onward unless you put them on the outgoing request.

Copying the header across is where it gets interesting, and it is why this package exists
rather than a snippet:

- **`headers.get('set-cookie')` is a trap.** It joins several cookies with `", "`, which is
  exactly what the comma inside `Expires=Wed, 21 Oct 2025 ...` looks like. Use
  `Headers.getSetCookie()`, which this package does, with a fallback splitter that understands
  the date comma.
- **Parsing and rebuilding loses attributes.** Turning a cookie into an object and baking it
  again drops whatever the parser has not heard of, `Partitioned` and `Priority` today and
  something else tomorrow. This package rewrites by splicing the original string instead.
- **Two cookies can share a name.** A framework cookie store is keyed by name, so one overwrites
  the other. Appending the raw header keeps both.
- **A wrong attribute fails silently.** `Domain=.example.com` on a local host, `Secure` over
  plain http, `SameSite=None` without `Secure`: the browser discards each one without a word.
- **Not every call site may write a cookie.** Next throws if you set one during a render.
- **Anything the backend sets would otherwise reach the browser**, including internal cookies.

## Install

```sh
pnpm add @concierge-kit/next     # Next.js App Router, 15 or 16
pnpm add @concierge-kit/h3       # Nuxt, or any nitro or h3 server
pnpm add @concierge-kit/core     # any other server runtime
```

## Three ways to use it

### A route handler with logic of its own

```ts
import { relay } from '@/lib/relay';

export async function POST(request: Request) {
  const upstream = await fetch(
    `${API}/login`,
    await relay.forward(request, {
      method: 'POST',
      body: await request.text(),
    }),
  );
  return relay.respond(upstream);
}
```

`respond` copies the status and body, drops the hop-by-hop headers that would break the browser,
and appends the allowed cookies as the raw strings the backend sent.

### A pure passthrough, as one re-export

```ts
// app/api/login/route.ts
export const POST = relay.route(`${API}/login`);
```

The incoming query string comes along, the request cookies are forwarded, and a backend redirect
stays a redirect instead of being followed.

### A server action

```ts
'use server';

export async function login(form: FormData) {
  const upstream = await fetch(`${API}/login`, await relay.forward({ method: 'POST', body: form }));
  const result = await relay.apply(upstream);
  if (result.relayed.length === 0) return { error: 'LOGIN_FAILED' };
}
```

`forward()` takes no request here because there is none to pass; the adapter reads the ambient
request instead. `apply` goes through Next's cookie store, which is the only surface available.
Prefer `respond` when a response object exists: the cookie store is keyed by name and models only
the attributes Next knows.

### Your own body with the backend's cookies

```ts
export const POST = withRelay(relay, async (request, { forward, relayFrom }) => {
  const upstream = await fetch(`${API}/login`, forward({ method: 'POST', body: request.body }));
  relayFrom(upstream);
  return NextResponse.json({ ok: upstream.ok });
});
```

## The policy

Every key and default is defined in `packages/core/src/policy/types.ts`, which is the source this
section is written from.

```ts
createRelay({
  cookie: {
    allow: ['access_token'], // required. no default, and never defaulted to true
    domain: 'auto', // 'keep' | 'strip' | 'auto' | (domain) => string | null | undefined
    secure: 'auto', // 'keep' | 'strip' | 'force' | 'auto'
    sameSite: 'auto', // 'keep' | 'auto' | 'lax' | 'strict' | 'none'
    path: 'keep', // 'keep' | string
    rename: { toBrowser, toUpstream },
  },
  forward: { cookies: ['access_token'] },
  onUnappliable: 'warn', // 'warn' | 'throw' | 'ignore'. read by the Next adapter only
});
```

`allow` takes a boolean, a name, a `RegExp`, a predicate, or an array of those combined with OR.
A predicate receives the cookie identity **without its value**, which is how cookie values are
kept out of your code by construction. Literal names narrow the result type, so
`allow: ['a', 'b']` gives you `relayed: ('a' | 'b')[]`.

The three `'auto'` rules only ever remove an attribute that would have made the browser reject
the cookie: a `Domain` the current host cannot match, `Secure` on a plain http request, and
`SameSite=None` left without `Secure`. Nothing else is touched.

Outside production the policy is checked when you declare it. A combination that could never
produce a storable cookie throws, a misspelled key throws, and a setting that silently does
nothing warns. Production pays nothing for any of it.

Every relay call returns what it did:

```ts
{ relayed: ['access_token'], dropped: [{ name: 'internal_trace', reason: 'not-allowed' }] }
```

Names and reasons only. A cookie value never appears in a return value, a log line, an error
message or a test snapshot.

## Without an adapter

The core knows `Request`, `Response`, `Headers` and `RequestInit`, and nothing else. It has no
dependencies, imports no framework and no Node built-in, so it runs unchanged on Edge, in
SvelteKit, in Hono, or in a plain script.

```ts
import { forwardRequestCookies, relaySetCookies, resolveRelayContext } from '@concierge-kit/core';

export async function POST({ request }) {
  const upstream = await fetch(API, forwardRequestCookies(request, { method: 'POST' }, policy));
  const response = new Response(upstream.body, { status: upstream.status });
  relaySetCookies(upstream, response.headers, cookiePolicy, resolveRelayContext(request));
  return response;
}
```

The one thing an adapter adds is the request context the `'auto'` rules need. Pass it yourself
here; the core cannot ask a framework what request it is handling.

## Do you have to use fetch?

No. conciergekit never calls `fetch` itself, and nothing in it requires you to.

`forward` returns a `RequestInit` because that is the shape most callers want, but the only
thing inside it that conciergekit owns is a `cookie` header. Take it and hand it to any client:

```ts
const init = forwardRequestCookies(request, undefined, { cookies: ['access_token'] });
const cookie = new Headers(init.headers).get('cookie');

await axios.get(url, { headers: { cookie } });
```

Coming back, the relay reads a `Headers`, not a `Response`. Build one from whatever shape your
client reports:

```ts
const raw = response.headers['set-cookie']; // axios, node:http, got
const lines = Array.isArray(raw) ? raw : splitSetCookieString(raw ?? '');

const from = new Headers();
for (const line of lines) from.append('set-cookie', line);

relaySetCookies(from, outgoing.headers, policy, context);
```

That second branch matters. A client that joins several cookies into one comma-separated string
is exactly the case `splitSetCookieString` exists for, and it knows the comma inside
`Expires=Tue, 21 Oct 2025 ...` is not a separator.

`examples/runtimes` proves all of this with `node:http` and no `fetch` anywhere.

The Next.js adapter is the one place fetch shows up, and even there it is your call, not the
package's: `relay.route()` performs the request for you, while `relay.forward()` and
`relay.respond()` only prepare and consume one.

## Nuxt

```sh
pnpm add @concierge-kit/h3
```

```ts
// server/utils/relay.ts
import { createRelay } from '@concierge-kit/h3';

export const relay = createRelay({
  cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});
```

```ts
// server/api/login.post.ts
export default defineEventHandler(async (event) => {
  const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
  return relay.respond(event, upstream);
});

// or, as one re-export
export default relay.route(`${API}/login`);
```

The h3 adapter is simpler than the Next.js one in two ways. There is one write path rather than
two, because an h3 handler can always append a response header, so cookies always travel as the
raw strings the backend sent. And `onUnappliable` means nothing here: it describes the React
Server Component rule that a cookie cannot be written mid-render, which has no counterpart in
Nuxt.

`forward` and `apply` are synchronous, because h3 hands you the request directly. Only `respond`
awaits, since it sends.

Peer is `h3` 1.15 or later, which is what Nuxt 4 ships through nitropack. When h3 v2 moves to web
standards, one file in the adapter changes.

## Other runtimes

SvelteKit, Hono, Cloudflare Workers and Deno need no adapter at all, because their handlers
already receive a standard `Request` and return a standard `Response`. See
[Without an adapter](#without-an-adapter). `examples/runtimes` runs that path for real.

## Status

Maturity is reported as test counts, not as check marks.

| Module                              | What it does                                          | Tests | Maturity         |
| ----------------------------------- | ----------------------------------------------------- | ----: | ---------------- |
| `core/cookie/rewriteSetCookie`      | Attribute rewriting by splicing the original string   |    18 | Trust it         |
| `core/cookie/relaySetCookies`       | Backend to browser, allow policy applied              |    10 | Trust it         |
| `core/cookie/forwardRequestCookies` | Browser to backend                                    |    10 | Trust it         |
| `core/cookie/scanSetCookie`         | Offset scanner behind the rewriting                   |     9 | Trust it         |
| `core/cookie/splitSetCookie`        | `getSetCookie` and the date-aware fallback            |     8 | Trust it         |
| `core/cookie/matchCookie`           | Matcher shapes and OR arrays                          |     8 | Trust it         |
| `core/context`                      | Request context and domain matching                   |     9 | Trust it         |
| `core/policy/validate`              | Development-time policy checks                        |     9 | Trust it         |
| `core/headers/hopByHop`             | Headers that must not be copied onward                |     4 | Trust it         |
| `core/createRelay`                  | Instance wiring                                       |     4 | Trust it         |
| Type narrowing (`*.test-d.ts`)      | Matcher literals, value secrecy                       |     8 | Trust it         |
| `next/apply`                        | Server action path, `onUnappliable`                   |     8 | Trust it         |
| `next/route`                        | Passthrough factory                                   |     7 | Trust it         |
| `next/respond`                      | Route handler path                                    |     6 | Trust it         |
| `next/withRelay`                    | Handler wrapper                                       |     5 | Trust it         |
| `next/cookieStoreInit`              | Attribute mapping for the cookie store                |     5 | Trust it         |
| `next/forward`                      | Ambient request reading                               |     2 | Usable, check it |
| End to end, real browser            | Domain, Secure, SameSite, allow list, both directions |    12 | Trust it         |
| `core/node` request context         | `AsyncLocalStorage` snapshot, unused until h3         |     0 | Thin             |
| h3 / Nuxt adapter                   |                                                       |     0 | Absent           |
| React server components             |                                                       |     0 | Absent           |

Totals: 97 unit and type tests in the core, 33 integration tests in the Next adapter, 14 in the h3
adapter, 6 for the documented runtime recipes, and 12 browser tests end to end.

The end to end suite runs against `dev.example.test`, not `localhost`. Browsers treat `localhost`
as a secure context, so they store a `Secure` cookie over plain http and never show a `Domain`
mismatch. A suite that passed there would prove nothing. Six of the twelve tests are control
cases running a deliberately naive relay, and they assert the browser throws the cookie away.

## Not in this release

Request header propagation and correlation ids, response header filtering beyond hop-by-hop,
internal versus public base URLs, redirect path normalisation, timeouts and retries, error
normalisation, structured logging, and a middleware adapter. Each has a place in the existing
structure; see `docs/design-memo.md` for where each one lands.

The next one is a middleware adapter, which is the only way to set a cookie that the same render
can see.

## Packages

| Package                                | What it is                                       |
| -------------------------------------- | ------------------------------------------------ |
| [`@concierge-kit/core`](packages/core) | Web standards only, zero dependencies, Edge-safe |
| [`@concierge-kit/next`](packages/next) | Next.js App Router adapter, 15 and 16            |

## Development

```sh
pnpm install
pnpm test        # unit, type and integration tests
pnpm typecheck   # a separate gate: a bundler strips types without checking them
pnpm build
pnpm --filter @concierge-kit/e2e exec playwright install chromium
pnpm e2e
```

`pnpm deps:check` and `pnpm unused:check` guard dependency version drift and unused exports.
`next` is deliberately pinned to 15 in the adapter and 16 in the playground, so both supported
majors are exercised; it is the one dependency excluded from the version consistency check.

## License

MIT
