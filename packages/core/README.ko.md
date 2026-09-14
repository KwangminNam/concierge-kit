# @concierge-kit/core

[English](./README.md) · **한국어**

[concierge-kit](https://github.com/KwangminNam/concierge-kit) 의 헤드리스 절반입니다.
어떤 서버 런타임에서든 브라우저와 백엔드 사이에서 쿠키를 중계합니다.

아는 타입은 `Request`, `Response`, `Headers`, `RequestInit` 네 개뿐입니다. 의존성이 없고,
프레임워크를 import 하지 않으며, 메인 진입점에는 Node 내장 모듈도 없습니다. 그래서 Edge,
SvelteKit, Hono, 또는 평범한 스크립트에서 그대로 돕니다.

```sh
pnpm add @concierge-kit/core
```

## 인스턴스로 쓰기

```ts
import { createRelay } from '@concierge-kit/core';

const relay = createRelay({
  cookie: { allow: ['access_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token'] },
});
```

| 메서드                               | 하는 일                                             |
| ------------------------------------ | --------------------------------------------------- |
| `relay.relayCookies(from, to, ctx?)` | 백엔드 `Set-Cookie` 를 브라우저로 갈 응답에         |
| `relay.forwardCookies(from, init?)`  | 브라우저 쿠키를 백엔드로 갈 요청에                  |
| `relay.prepareHeaders(from)`         | hop-by-hop 과 모든 `Set-Cookie` 를 뺀 upstream 헤더 |

## 인스턴스 없이 쓰기

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

`resolveRelayContext` 가 `'auto'` 규칙의 판단 근거입니다. 요청 URL 보다 `x-forwarded-proto` 를
먼저 봅니다. 컨테이너 안에서는 브라우저가 https 를 썼어도 요청 URL 이 거의 항상 평문 http 라,
URL 을 먼저 믿으면 프로덕션의 모든 쿠키에서 `Secure` 가 벗겨지기 때문입니다.

## 구성 요소

| export                   | 내용                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `splitSetCookie`         | `getSetCookie()` 또는 날짜를 아는 폴백으로 각 `Set-Cookie` 를 분리 |
| `scanSetCookie`          | 쿠키를 오프셋으로 색인. 절대 분해하지 않음                         |
| `rewriteSetCookie`       | 원문 문자열을 잘라 붙이는 방식의 수정                              |
| `matchCookie`            | 모든 matcher 형태와 OR 로 묶인 배열                                |
| `pipeSetCookies`         | 분리, 판정, 수정, 싱크로 전달. 두 경로가 공유하는 엔진             |
| `relaySetCookies`        | 싱크가 `Headers` 인 `pipeSetCookies`                               |
| `forwardRequestCookies`  | 반대 방향                                                          |
| `prepareResponseHeaders` | 안전한 upstream 헤더. `Set-Cookie` 는 의도적으로 제거              |
| `stripHopByHopHeaders`   | hop-by-hop 제거만                                                  |

## 수정 방식이 이런 이유

쿠키를 객체로 파싱했다가 다시 굽는 일은 없습니다. 원문을 한 번 훑어 각 속성의 오프셋을 기록하고,
`Domain`, `Secure`, `SameSite`, `Path` 넷만 잘라 붙입니다.

```
sid=abc; Path=/; Domain=.example.com; Secure; SameSite=None; Partitioned
                 └────── 잘라냄 ─────┘ └잘라냄┘ └── 치환 ──┘  └ 손 안 댐 ┘
```

코드가 모르는 속성은 코드가 그것이 있다는 사실조차 모르기 때문에 살아남습니다. 지금 문제가 되는
것은 `Partitioned` 와 `Priority` 둘이고, 다음에 생길 것도 마찬가지로 살아남습니다.

## Node 서브패스

```ts
import { runWithRequest, getRequestSnapshot } from '@concierge-kit/core/node';
```

현재 요청에 닿을 다른 방법이 없는 런타임을 위한 `AsyncLocalStorage` 요청 스냅샷입니다.
Edge 에서 코어를 import 하기만 해도 `node:async_hooks` 가 끌려오는 일을 막으려고 서브패스에
두었습니다. Next.js 어댑터는 대신 `headers()` 를 읽으며 이것을 쓰지 않습니다.

## 라이선스

MIT
