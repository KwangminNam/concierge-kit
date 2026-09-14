# @concierge-kit/core

The headless half of [concierge-kit](https://github.com/KwangminNam/concierge-kit). Relays cookies
between a browser and a backend from any server runtime.

Knows four types: `Request`, `Response`, `Headers`, `RequestInit`. No dependencies, no framework
imports, no Node built-ins in the main entry, so it runs unchanged on Edge, in SvelteKit, in
Hono, or in a plain script.

```sh
pnpm add @concierge-kit/core
```

## With an instance

```ts
import { createRelay } from '@concierge-kit/core';

const relay = createRelay({
  cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});
```

| Method                               | What it does                                                   |
| ------------------------------------ | -------------------------------------------------------------- |
| `relay.relayCookies(from, to, ctx?)` | Backend `Set-Cookie` onto a browser-bound response             |
| `relay.forwardCookies(from, init?)`  | Browser cookies onto a backend-bound request                   |
| `relay.prepareHeaders(from)`         | Upstream headers minus hop-by-hop and minus every `Set-Cookie` |

## Without one

```ts
import {
  forwardRequestCookies,
  relaySetCookies,
  resolveRelayContext,
  prepareResponseHeaders,
} from '@concierge-kit/core';

export async function POST({ request }) {
  const upstream = await fetch(
    API,
    forwardRequestCookies(request, { method: 'POST' }, forwardPolicy),
  );
  const headers = prepareResponseHeaders(upstream.headers);
  relaySetCookies(upstream, headers, cookiePolicy, resolveRelayContext(request));
  return new Response(upstream.body, { status: upstream.status, headers });
}
```

`resolveRelayContext` is what the `'auto'` rules judge against. It reads `x-forwarded-proto`
before the request URL, because inside a container the URL is almost always plain http even when
the browser used https, and trusting it would strip `Secure` from every cookie in production.

## The building blocks

| Export                   | What it is                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `splitSetCookie`         | Every `Set-Cookie` as a separate string, via `getSetCookie()` or a date-aware fallback |
| `scanSetCookie`          | A cookie indexed by offset, never taken apart                                          |
| `rewriteSetCookie`       | The rewrite, done by splicing the original string                                      |
| `matchCookie`            | Every matcher shape, and arrays combined with OR                                       |
| `pipeSetCookies`         | Split, match, rewrite, hand to a sink. The engine both paths share                     |
| `relaySetCookies`        | `pipeSetCookies` with a `Headers` as the sink                                          |
| `forwardRequestCookies`  | The other direction                                                                    |
| `prepareResponseHeaders` | Safe upstream headers, `Set-Cookie` deliberately removed                               |
| `stripHopByHopHeaders`   | Just the hop-by-hop removal                                                            |

## Why the rewriting works this way

A cookie is never parsed into an object and baked again. The original string is scanned once for
the offset of each attribute, and only `Domain`, `Secure`, `SameSite` and `Path` are spliced.

```
sid=abc; Path=/; Domain=.example.com; Secure; SameSite=None; Partitioned
                 └────── spliced ────┘ └splice┘ └ replaced ┘  └ untouched ┘
```

Attributes the code has never heard of survive because the code does not know they are there.
`Partitioned` and `Priority` are the two that matter today; the next one will survive too.

## The Node subpath

```ts
import { runWithRequest, getRequestSnapshot } from '@concierge-kit/core/node';
```

An `AsyncLocalStorage` request snapshot, for runtimes with no other way to reach the current
request. Kept on a subpath so that importing the core on Edge can never pull in
`node:async_hooks`. The Next.js adapter reads `headers()` instead and never touches this.

## License

MIT
