# concierge-kit

**English** · [한국어](./README.ko.md)

A relay for the server layer of a frontend app. The concierge deals with the backend so your
handlers do not have to.

Next.js App Router and Nuxt both let the frontend call a backend from their own server runtime.
Every project that does it writes the same plumbing by hand, gets one attribute wrong, and
watches a cookie disappear without an error. This package is that plumbing, declared once.

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

## Replacing a hand rolled relay

Before, spread across three files:

```diff
-// setCookieFromApi.ts
-import { cookies } from 'next/headers';
-import setCookieParser from 'set-cookie-parser';
-
-export async function setCookieFromApi(setCookieList: string[]) {
-  if (setCookieList.length === 0) return;
-  const parsed = setCookieList.map((s) => setCookieParser.parse(s)[0]);
-  await Promise.all(parsed.map(async (cookie) => {
-    const store = await cookies();
-    store.set({
-      ...cookie,
-      // domain: isDeploy() ? cookie.domain : undefined,
-      // secure: isDeploy() ? cookie.secure : false,
-      sameSite: cookie.sameSite as 'lax' | 'strict' | 'none' | undefined,
-    });
-  }));
-}
-
-// getRequestHeaders.ts
-const REQUIRED_HEADERS = ['cookie'];
-export async function getRequestHeaders() {
-  return [...(await headers()).entries()]
-    .filter(([k]) => REQUIRED_HEADERS.includes(k))
-    .reduce((acc, [k, v]) => Object.assign(acc, { [k]: v }), {});
-}
-
-// FetchClient.ts
-const res = await fetch(fullURL, { ...options, headers: await getRequestHeaders() });
-if (options.method !== 'GET') {
-  await setCookieFromApi(res.headers.getSetCookie());
-}
+// lib/relay.ts
+import { createRelay } from '@concierge-kit/next';
+
+export const relay = createRelay({
+  cookie: { allow: ['access_token', 'refresh_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
+  forward: { cookies: ['access_token', 'refresh_token'] },
+});
+
+// app/api/login/route.ts
+export async function POST(request: Request) {
+  const upstream = await fetch(fullURL, await relay.forward(request, options));
+  return relay.respond(upstream);
+}
```

What the diff removes, in order: the parse and rebuild that was dropping `Partitioned` and
`Priority`; the name-keyed store that was collapsing two cookies sharing a name; the commented
out environment handling; the `method !== 'GET'` guard that was hiding the render restriction by
accident; and the absence of an allow list, which let every backend cookie through.

What it adds is a return value that tells you which cookies were relayed and why the rest were
not.

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

Totals: 97 unit and type tests in the core, 33 integration tests in the Next adapter, 12 browser
tests end to end.

The end to end suite runs against `dev.example.test`, not `localhost`. Browsers treat `localhost`
as a secure context, so they store a `Secure` cookie over plain http and never show a `Domain`
mismatch. A suite that passed there would prove nothing. Six of the twelve tests are control
cases running a deliberately naive relay, and they assert the browser throws the cookie away.

## Not in this release

Request header propagation and correlation ids, response header filtering beyond hop-by-hop,
internal versus public base URLs, redirect path normalisation, timeouts and retries, error
normalisation, structured logging, and a middleware adapter. Each has a place in the existing
structure; see `docs/design-memo.md` for where each one lands.

The next two, in order, are a middleware adapter, which is the only way to set a cookie that the
same render can see, and an h3 adapter for Nuxt.

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
