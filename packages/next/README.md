# @concierge-kit/next

**English** · [한국어](./README.ko.md)

Next.js App Router adapter for [concierge-kit](https://github.com/KwangminNam/concierge-kit).
Relays cookies between the browser and your backend from route handlers and server actions.

```sh
pnpm add @concierge-kit/next
```

Peer: `next` 15 or 16, React 18.2 or later. Node 20.9 or later.

## Declare the policy once

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
  onUnappliable: 'warn',
});
```

## Use it

```ts
// a route handler with logic of its own
export async function POST(request: Request) {
  const upstream = await fetch(
    `${API}/login`,
    await relay.forward(request, { method: 'POST', body: request.body }),
  );
  return relay.respond(upstream);
}

// a pure passthrough
export const POST = relay.route(`${API}/login`);

// a server action
('use server');
export async function login(form: FormData) {
  const upstream = await fetch(`${API}/login`, await relay.forward({ method: 'POST', body: form }));
  await relay.apply(upstream);
}

// your own body, the backend's cookies
export const POST = withRelay(relay, async (request, { forward, relayFrom }) => {
  const upstream = await fetch(`${API}/login`, forward({ method: 'POST', body: request.body }));
  relayFrom(upstream);
  return NextResponse.json({ ok: upstream.ok });
});
```

Every method on the relay is asynchronous, because reading the current request in Next is
asynchronous. The inherited core methods stay synchronous.

## Which path to take

`respond` writes cookies as the raw headers the backend sent. Two cookies that share a name but
differ in `Path` both survive, and every attribute survives with them.

`apply` goes through Next's cookie store, because a server action has no response object. The
store is keyed by name, so two cookies sharing a name collapse into one, and only the attributes
Next models come through: `Partitioned` and `Priority` do, anything newer does not. Prefer
`respond` wherever a response exists.

There is no automatic choice between them. Detecting the call site would mean reading Next's
private request store, which breaks between majors, and the symptom when it breaks is a cookie
quietly failing to appear.

## Writing a cookie the current render can see

Next refuses `cookies().set()` during a React Server Component render, by design. `apply` reports
it rather than crashing:

```ts
const result = await relay.apply(upstream);
// { relayed: [], dropped: [{ name: 'access_token', reason: 'unappliable' }] }
```

`onUnappliable` chooses between `'warn'`, `'throw'` and `'ignore'`.

If you actually need a cookie the current render can see, no call site can give you one. A route
handler writes a cookie for the _next_ request; a render writes none. The proxy is the layer that
can, because it runs after the request arrives and before the render starts:

```ts
// proxy.ts
export const proxy = relay.proxy({
  endpoint: `${API}/auth/refresh`,
  when: (request) => !request.cookies.has('access_token') && request.cookies.has('refresh_token'),
  onFailure: 'clear',
});
```

It writes both sides at once: `Set-Cookie` on the response for the browser, and a rewritten
`cookie` header on the request so this render reads the rotated token. Doing only one half fails
silently, in opposite directions.

`rotateFromUpstream(relay, request, upstream)` does the two-sided write for a flow of your own,
and `clearSession(request, names)` ends a session for the browser and the request in flight at
once.

Next 15 runs `middleware.ts` on Edge by default; Next 16 runs `proxy.ts` on Node. The core is
Edge safe either way.

## One file touches Next

Every Next.js API this package uses lives in `src/framework.ts`. A breaking change in Next lands
in that file and nowhere else, and the integration suite replaces the whole framework by mocking
one module, which is how it reproduces a cookie store refusing a write mid-render.

## License

MIT
