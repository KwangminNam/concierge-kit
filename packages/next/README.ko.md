# @concierge-kit/next

[English](./README.md) · **한국어**

[concierge-kit](https://github.com/KwangminNam/concierge-kit) 의 Next.js App Router 어댑터입니다.
라우트 핸들러와 서버 액션에서 브라우저와 백엔드 사이의 쿠키를 중계합니다.

```sh
pnpm add @concierge-kit/next
```

peer 는 `next` 15 또는 16, React 18.2 이상입니다. Node 는 20.9 이상.

## 정책은 한 번만 선언합니다

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

## 사용법

```ts
// 로직이 있는 라우트 핸들러
export async function POST(request: Request) {
  const upstream = await fetch(
    `${API}/login`,
    await relay.forward(request, { method: 'POST', body: request.body }),
  );
  return relay.respond(upstream);
}

// 순수 패스스루
export const POST = relay.route(`${API}/login`);

// 서버 액션
('use server');
export async function login(form: FormData) {
  const upstream = await fetch(`${API}/login`, await relay.forward({ method: 'POST', body: form }));
  await relay.apply(upstream);
}

// 내 응답 본문에 백엔드의 쿠키를
export const POST = withRelay(relay, async (request, { forward, relayFrom }) => {
  const upstream = await fetch(`${API}/login`, forward({ method: 'POST', body: request.body }));
  relayFrom(upstream);
  return NextResponse.json({ ok: upstream.ok });
});
```

relay 의 모든 메서드는 비동기입니다. Next 에서 현재 요청을 읽는 일이 비동기이기 때문입니다.
코어에서 상속한 메서드는 동기 그대로입니다.

## 어느 경로를 쓸 것인가

`respond` 는 백엔드가 보낸 원문 헤더 그대로 쿠키를 씁니다. 이름이 같고 `Path` 가 다른 쿠키 둘이
모두 살아남고, 모든 속성이 함께 살아남습니다.

`apply` 는 Next 의 쿠키 저장소를 거칩니다. 서버 액션에는 응답 객체가 없기 때문입니다. 저장소는
이름이 키라 같은 이름의 쿠키 둘이 하나로 합쳐지고, Next 가 모델링하는 속성만 통과합니다.
`Partitioned` 와 `Priority` 는 통과하고 그보다 새로운 것은 통과하지 않습니다. 응답 객체가 있는
곳에서는 `respond` 를 쓰세요.

둘을 자동으로 고르는 기능은 없습니다. 호출 지점을 감지하려면 Next 의 비공개 요청 저장소를 읽어야
하는데, 메이저 버전마다 깨지고 깨졌을 때의 증상이 쿠키가 조용히 나타나지 않는 것입니다.

## 지금 렌더가 볼 수 있는 쿠키 쓰기

Next 는 React 서버 컴포넌트 렌더 중의 `cookies().set()` 을 설계상 거부합니다. `apply` 는
크래시 대신 그 사실을 보고합니다.

```ts
const result = await relay.apply(upstream);
// { relayed: [], dropped: [{ name: 'access_token', reason: 'unappliable' }] }
```

`onUnappliable` 로 `'warn'`, `'throw'`, `'ignore'` 중에서 고릅니다.

지금 렌더가 볼 수 있는 쿠키가 정말로 필요하다면, 어떤 호출 지점도 그것을 줄 수 없습니다.
라우트 핸들러가 쓰는 쿠키는 **다음** 요청의 것이고, 렌더는 아무것도 쓰지 못합니다. 줄 수 있는
계층은 프록시입니다. 요청이 도착한 뒤 렌더가 시작되기 전에 돌기 때문입니다.

```ts
// proxy.ts
export const proxy = relay.proxy({
  endpoint: `${API}/auth/refresh`,
  when: (request) => !request.cookies.has('access_token') && request.cookies.has('refresh_token'),
  onFailure: 'clear',
});
```

양쪽을 동시에 씁니다. 브라우저를 위해 응답에 `Set-Cookie` 를 싣고, 이번 렌더가 회전된 토큰을
읽도록 요청의 `cookie` 헤더를 다시 씁니다. 한쪽만 하면 반대 방향으로 조용히 실패합니다.

직접 흐름을 짤 때는 `rotateFromUpstream(relay, request, upstream)` 이 양쪽 쓰기를 해 주고,
`clearSession(request, names)` 이 브라우저와 진행 중인 요청의 세션을 한꺼번에 끝냅니다.

Next 15 는 `middleware.ts` 를 기본적으로 Edge 에서, Next 16 은 `proxy.ts` 를 Node 에서
실행합니다. 코어는 어느 쪽이든 Edge 안전합니다.

## Next 를 건드리는 파일은 하나뿐

이 패키지가 쓰는 모든 Next.js API 는 `src/framework.ts` 에 있습니다. Next 의 변경이 그 파일
하나에만 도달하고, 통합 테스트는 모듈 하나를 mock 해서 프레임워크 전체를 대체합니다. 렌더 도중
쿠키 저장소가 쓰기를 거부하는 상황을 재현하는 방법이 바로 이것입니다.

## 라이선스

MIT
