# @concierge-kit/h3

**English** · [한국어](./README.ko.md)

h3 and Nuxt adapter for [concierge-kit](https://github.com/KwangminNam/concierge-kit). Relays
cookies between the browser and your backend from a nitro server route.

```sh
pnpm add @concierge-kit/h3
```

Peer: `h3` 1.15 or later, which is what Nuxt 4 ships through nitropack. Node 20.9 or later.

## Declare the policy once

```ts
// server/utils/relay.ts
import { createRelay } from '@concierge-kit/h3';

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

## Use it

```ts
// server/api/login.post.ts — pass the backend answer straight through
export default defineEventHandler(async (event) => {
  const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
  return relay.respond(event, upstream);
});

// server/api/login.post.ts — your own body, the backend's cookies
export default defineEventHandler(async (event) => {
  const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
  const result = relay.apply(event, upstream);
  return { ok: upstream.ok, relayed: result.relayed };
});

// server/api/login.post.ts — a pure passthrough, as one re-export
export default relay.route(`${API}/login`);
```

`forward` and `apply` are synchronous. h3 hands you the request directly, so unlike the Next.js
adapter nothing has to be awaited to find out who is calling. Only `respond` is asynchronous,
because it sends.

## Simpler than the Next.js adapter, in two ways

There is one write path, not two. An h3 handler can always append a response header, so there is
no cookie store fallback and cookies always travel as the raw strings the backend sent. Two
cookies that share a name but differ in `Path` both survive, and attributes conciergekit has
never heard of survive with them.

`onUnappliable` is accepted and ignored. It describes the React Server Component rule that a
cookie cannot be written during a render, which has no counterpart here.

## Where the context comes from

The `'auto'` rules need to know the scheme and host the browser actually used. This adapter reads
them from `getRequestProtocol` and `getRequestHost`, which consult `x-forwarded-proto` and
`x-forwarded-host` before the socket. That order matters: behind a proxy the socket is plain http
even when the browser used https, and trusting it would strip `Secure` from every cookie in
production.

## One file touches h3

Every h3 API this package uses lives in `src/framework.ts`. When h3 v2 lands and moves to web
standards, that file changes and nothing else does. The tests need no mocking at all, because an
h3 app is a plain node listener: every test here runs a real server.

## License

MIT
