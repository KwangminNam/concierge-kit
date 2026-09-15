# @concierge-kit/h3

[English](./README.md) · **한국어**

[concierge-kit](https://github.com/KwangminNam/concierge-kit) 의 h3 및 Nuxt 어댑터입니다.
nitro 서버 라우트에서 브라우저와 백엔드 사이의 쿠키를 중계합니다.

```sh
pnpm add @concierge-kit/h3
```

peer 는 `h3` 1.15 이상입니다. Nuxt 4 가 nitropack 을 거쳐 쓰는 버전입니다. Node 는 20.9 이상.

## 정책은 한 번만 선언합니다

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

## 사용법

```ts
// server/api/login.post.ts — 백엔드 응답을 그대로 통과
export default defineEventHandler(async (event) => {
  const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
  return relay.respond(event, upstream);
});

// server/api/login.post.ts — 내 응답 본문에 백엔드의 쿠키를
export default defineEventHandler(async (event) => {
  const upstream = await fetch(`${API}/login`, relay.forward(event, { method: 'POST' }));
  const result = relay.apply(event, upstream);
  return { ok: upstream.ok, relayed: result.relayed };
});

// server/api/login.post.ts — 순수 패스스루, 재수출 한 줄
export default relay.route(`${API}/login`);
```

`forward` 와 `apply` 는 동기입니다. h3 가 요청을 바로 건네주기 때문에, Next.js 어댑터와 달리
누가 호출했는지 알아내려고 await 할 것이 없습니다. 비동기인 것은 응답을 실제로 보내는
`respond` 뿐입니다.

## Next.js 어댑터보다 단순한 두 가지

쓰기 경로가 하나입니다. h3 핸들러는 언제나 응답 헤더를 추가할 수 있어서 쿠키 저장소 폴백이
없고, 쿠키는 항상 백엔드가 보낸 원문 그대로 전달됩니다. 이름이 같고 `Path` 가 다른 쿠키 둘이
모두 살아남고, 이 패키지가 들어본 적 없는 속성도 함께 살아남습니다.

`onUnappliable` 은 받아들이되 무시합니다. 렌더 중에 쿠키를 쓸 수 없다는 React 서버 컴포넌트의
규칙을 설명하는 옵션이고, 여기에는 대응물이 없습니다.

## 컨텍스트는 어디서 오나

`'auto'` 규칙은 브라우저가 실제로 쓴 스킴과 호스트를 알아야 합니다. 이 어댑터는 그것을
`getRequestProtocol` 과 `getRequestHost` 에서 읽습니다. 두 함수는 소켓보다
`x-forwarded-proto` 와 `x-forwarded-host` 를 먼저 봅니다. 이 순서가 중요합니다. 프록시 뒤에서는
브라우저가 https 를 썼어도 소켓은 평문 http 이고, 소켓을 믿으면 프로덕션의 모든 쿠키에서
`Secure` 가 벗겨집니다.

## 미들웨어만 할 수 있는 한 가지

핸들러가 쓰는 쿠키는 브라우저가 **다음** 요청에 실어 보냅니다. 요청 도중 토큰이 만료되면,
라우트보다 먼저 도는 무언가만이 갱신하면서 그 요청이 새 값을 보게 할 수 있습니다.

```ts
// server/middleware/refresh.ts
export default relay.refresh({
  endpoint: `${API}/auth/refresh`,
  when: (event) => !getCookie(event, 'access_token') && !!getCookie(event, 'refresh_token'),
  onFailure: 'clear',
});
```

양쪽을 동시에 씁니다. 브라우저용 응답 `Set-Cookie` 와, 요청 객체 위의 다시 쓰인 `cookie`
헤더입니다. 그 뒤의 모든 핸들러와 Nuxt 의 `useRequestHeaders` 가 거기서 읽습니다. 직접 흐름을
짤 때는 `rotateOnEvent` 와 `clearSessionOnEvent` 가 양쪽 쓰기를 해 줍니다.

## 요청 헤더와 상관 ID

```ts
forward: { headers: ['accept-language'], requestId: { header: 'x-request-id' } }
```

허용된 헤더는 건너가고 `host`, `content-length`, `cookie`, hop-by-hop 헤더는 절대 건너가지
않습니다. 상관 ID 는 브라우저에서 받거나 이벤트당 한 번 만들어지며, 요청의 모든 백엔드 호출이
같은 값을 보냅니다.

## 요청당 시간 예산 하나

```ts
export const relay = createRelay({ /* ... */ deadline: { budget: 3000 } });
```

시계는 요청의 첫 `relay.forward(event)` 에서, 또는 nitro `request` 훅에서 `relay.stamp(event)`
로 더 일찍 시작되며 `event.context` 에 삽니다. 같은 요청의 이후 호출은 남은 것을 `AbortSignal`
과 `x-request-deadline` 헤더로 실어 갑니다. `relay.deadline(event)` 은 남은 예산과 신호를
직접 돌려줍니다.

## h3 를 건드리는 파일은 하나뿐

이 패키지가 쓰는 모든 h3 API 는 `src/framework.ts` 에 있습니다. h3 v2 가 나와 웹 표준으로
옮겨가면 그 파일만 바뀌고 나머지는 그대로입니다. 테스트에는 mock 이 전혀 필요 없습니다.
h3 앱은 평범한 node 리스너라서, 여기 테스트는 전부 실제 서버를 띄웁니다.

## 라이선스

MIT
