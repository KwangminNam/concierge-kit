# concierge-kit

[English](./README.md) · **한국어**

프론트엔드 서버 레이어를 위한 릴레이입니다. 컨시어지가 백엔드를 대신 상대해 주므로 핸들러가
그 일을 하지 않아도 됩니다.

Next.js App Router 도 Nuxt 도 프론트엔드가 자기 서버 런타임에서 백엔드를 호출하게 해 줍니다.
그렇게 하는 모든 프로젝트가 같은 배관 작업을 손으로 다시 쓰고, 속성 하나를 틀리고, 쿠키가
아무 에러 없이 사라지는 것을 지켜봅니다. 이 패키지가 그 배관이며, 한 번만 선언하면 됩니다.

## 쓰기 전과 후

### 전

파일 세 개, 마흔 줄 남짓, 그리고 에러 메시지 없이 사라지는 쿠키.

```ts
// setCookieFromApi.ts
import { cookies } from 'next/headers';
import setCookieParser from 'set-cookie-parser';

export async function setCookieFromApi(setCookieList: string[]) {
  if (setCookieList.length === 0) return;
  const parsed = setCookieList.map((s) => setCookieParser.parse(s)[0]); // (1) 여기서 속성이 사라진다
  await Promise.all(
    parsed.map(async (cookie) => {
      const store = await cookies();
      store.set({
        // (2) 이름이 키라 쿠키 하나가 다른 하나를 덮는다
        ...cookie,
        // domain: isDeploy() ? cookie.domain : undefined,   // (3) 포기하고 주석으로 남김
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
  // (4) 크래시를 우연히 가리고 있던 가드
  await setCookieFromApi(res.headers.getSetCookie()); // (5) allow 목록 없음. 전부 통과
}
```

### 후

정책은 파일 하나가 선언합니다. 호출부는 한 줄입니다.

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

### 번호마다 치르던 대가

|      | 전에 무엇이 잘못됐나                                                                    | 무엇이 보였나                                                                        | 지금은 어떻게 되나                                                                         |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| (1)  | 쿠키를 객체로 파싱했다가 다시 구워서, 파서가 모르는 속성이 전부 떨어졌다                | `Partitioned` 와 `Priority` 가 조용히 사라지고 CHIPS 가 깨진다                       | 원문 문자열을 잘라 붙이므로 코드가 들어본 적 없는 속성도 바이트 그대로 통과한다            |
| (2)  | 프레임워크 쿠키 저장소는 이름이 키다                                                    | 이름이 같고 `Path` 가 다른 쿠키 둘이 하나로 합쳐진다                                 | 원문 헤더로 추가하므로 둘 다 살아남는다                                                    |
| (3)  | 환경 차이를 해결한 적이 없고 주석 처리만 해 두었다                                      | localhost 의 `Domain=.example.com`, http 의 `Secure`. 브라우저가 아무 말 없이 버린다 | `domain: 'auto'` 와 `secure: 'auto'` 가 요청마다 판단하고, 거부 원인이 될 속성만 제거한다  |
| (4)  | `method !== 'GET'` 가 렌더 중 쿠키 설정 시 Next 가 예외를 던진다는 사실을 가리고 있었다 | 운으로 동작했다. 쿠키가 필요한 첫 `GET` 에서 터진다                                  | 라우트 핸들러는 응답에 쓰고, `onUnappliable` 이 렌더 중 쓰기를 크래시 대신 기록으로 바꾼다 |
| (5)  | 백엔드가 설정한 쿠키가 전부 브라우저까지 갔다                                           | 백엔드 내부 쿠키가 클라이언트로 새는데 아무도 모른다                                 | `allow` 는 필수이고 기본값은 아무것도 중계하지 않으며, 키 오타는 개발 중에 예외를 던진다   |
| 전체 | 실제로 무슨 일이 일어났는지 알 방법이 없었다                                            | 응답 헤더를 손으로 읽으며 디버깅                                                     | 모든 호출이 `{ relayed, dropped }` 를 이름과 사유로 돌려준다. 값은 절대 없다               |

호출부에서 사라지는 것은 메서드 분기, 환경 분기, 파싱 의존성, 헤더 수집 헬퍼입니다. 대신 생기는
것은 "실제로 넘어갔는가, 안 넘어갔다면 왜인가"에 대한 답입니다.

## 쿠키가 사라지는 이유

서버의 `fetch` 에는 쿠키 저장소가 없습니다. 서버가 백엔드를 호출하는 것은 브라우저가 존재조차
모르는 두 번째 HTTP 트랜잭션이라, 백엔드의 `Set-Cookie` 는 서버 안의 응답 객체에 앉았다가
버려집니다. 반대 방향도 자동이 아닙니다. 브라우저의 쿠키는 나가는 요청에 직접 실어 주지 않으면
더 나아가지 않습니다.

헤더를 그냥 복사하면 되지 않느냐에서 이야기가 흥미로워지고, 이 패키지가 스니펫이 아니라 패키지인
이유가 여기에 있습니다.

- **`headers.get('set-cookie')` 는 함정입니다.** 여러 쿠키를 `", "` 로 이어 붙이는데,
  이것이 `Expires=Wed, 21 Oct 2025 ...` 안의 쉼표와 똑같이 생겼습니다. 이 패키지는
  `Headers.getSetCookie()` 를 쓰고, 없는 런타임에서는 날짜 쉼표를 아는 폴백 분리기로 갑니다.
- **파싱 후 재조립은 속성을 잃습니다.** 쿠키를 객체로 만들었다가 다시 구우면 파서가 모르는 것이
  전부 떨어집니다. 오늘은 `Partitioned` 와 `Priority` 이고 내일은 다른 것입니다. 이 패키지는
  대신 원문 문자열을 잘라 붙여 고칩니다.
- **이름이 같은 쿠키가 둘일 수 있습니다.** 프레임워크 쿠키 저장소는 이름이 키라 하나가 다른
  하나를 덮습니다. 원문 헤더를 추가하면 둘 다 살아남습니다.
- **속성이 틀리면 조용히 실패합니다.** 로컬 호스트의 `Domain=.example.com`, 평문 http 의
  `Secure`, `Secure` 없는 `SameSite=None`. 브라우저는 각각을 아무 말 없이 버립니다.
- **모든 호출 지점이 쿠키를 쓸 수 있는 것도 아닙니다.** Next 는 렌더 중에 쿠키를 설정하면
  예외를 던집니다.
- **백엔드가 설정한 것은 무엇이든 그대로 브라우저까지 갑니다.** 내부용 쿠키까지 포함해서요.

## 설치

```sh
pnpm add @concierge-kit/next     # Next.js App Router, 15 또는 16
pnpm add @concierge-kit/core     # 그 밖의 서버 런타임
```

## 세 가지 사용법

### 로직이 있는 라우트 핸들러

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

`respond` 는 상태와 본문을 그대로 옮기고, 브라우저를 망가뜨릴 hop-by-hop 헤더를 떨구고,
허용된 쿠키를 백엔드가 보낸 원문 그대로 추가합니다.

### 순수 패스스루, 재수출 한 줄

```ts
// app/api/login/route.ts
export const POST = relay.route(`${API}/login`);
```

들어온 쿼리 문자열이 함께 가고, 요청 쿠키가 전달되며, 백엔드의 리다이렉트는 따라가지 않고
리다이렉트인 채로 브라우저에 도착합니다.

### 서버 액션

```ts
'use server';

export async function login(form: FormData) {
  const upstream = await fetch(`${API}/login`, await relay.forward({ method: 'POST', body: form }));
  const result = await relay.apply(upstream);
  if (result.relayed.length === 0) return { error: 'LOGIN_FAILED' };
}
```

여기서 `forward()` 가 요청을 받지 않는 이유는 넘길 요청이 없기 때문입니다. 어댑터가 대신 현재
요청을 읽습니다. `apply` 는 Next 의 쿠키 저장소를 거치는데, 이 자리에서 쓸 수 있는 유일한 표면이기
때문입니다. 응답 객체가 있는 곳에서는 `respond` 를 쓰세요. 쿠키 저장소는 이름이 키이고 Next 가
아는 속성만 모델링합니다.

### 내 응답 본문에 백엔드의 쿠키를 얹기

```ts
export const POST = withRelay(relay, async (request, { forward, relayFrom }) => {
  const upstream = await fetch(`${API}/login`, forward({ method: 'POST', body: request.body }));
  relayFrom(upstream);
  return NextResponse.json({ ok: upstream.ok });
});
```

## 정책

모든 키와 기본값은 `packages/core/src/policy/types.ts` 에 정의돼 있고, 이 절은 그 파일을 근거로
쓰였습니다.

```ts
createRelay({
  cookie: {
    allow: ['access_token'], // 필수. 기본값 없음, true 로 기본값을 주는 일도 없음
    domain: 'auto', // 'keep' | 'strip' | 'auto' | (domain) => string | null | undefined
    secure: 'auto', // 'keep' | 'strip' | 'force' | 'auto'
    sameSite: 'auto', // 'keep' | 'auto' | 'lax' | 'strict' | 'none'
    path: 'keep', // 'keep' | string
    rename: { toBrowser, toUpstream },
  },
  forward: { cookies: ['access_token'] },
  onUnappliable: 'warn', // 'warn' | 'throw' | 'ignore'. Next 어댑터만 읽습니다
});
```

`allow` 는 불리언, 이름, `RegExp`, 조건 함수, 그리고 그것들을 OR 로 묶은 배열을 받습니다.
조건 함수에는 **값이 없는** 쿠키 정보가 넘어가며, 이것이 쿠키 값을 구조적으로 코드 밖에 두는
방법입니다. 이름 리터럴은 결과 타입을 좁혀서 `allow: ['a', 'b']` 는
`relayed: ('a' | 'b')[]` 를 줍니다.

세 개의 `'auto'` 규칙은 브라우저가 쿠키를 거부하게 만들었을 속성만 제거합니다. 현재 호스트가
매치할 수 없는 `Domain`, 평문 http 요청의 `Secure`, 그리고 `Secure` 없이 남은
`SameSite=None` 입니다. 그 외에는 손대지 않습니다.

프로덕션이 아닐 때는 정책을 선언하는 시점에 검사합니다. 저장 가능한 쿠키를 절대 만들 수 없는
조합은 예외를 던지고, 오타 난 키도 예외를 던지며, 조용히 아무 일도 하지 않는 설정은 경고합니다.
프로덕션은 이 중 어느 것에도 비용을 내지 않습니다.

모든 릴레이 호출은 자기가 한 일을 돌려줍니다.

```ts
{ relayed: ['access_token'], dropped: [{ name: 'internal_trace', reason: 'not-allowed' }] }
```

이름과 사유뿐입니다. 쿠키 값은 반환값, 로그, 에러 메시지, 테스트 스냅샷 어디에도 나타나지
않습니다.

## 어댑터 없이 쓰기

코어가 아는 것은 `Request`, `Response`, `Headers`, `RequestInit` 이 전부입니다. 의존성이 없고
프레임워크도 Node 내장 모듈도 import 하지 않으므로 Edge, SvelteKit, Hono, 또는 평범한 스크립트
에서 그대로 돕니다.

```ts
import { forwardRequestCookies, relaySetCookies, resolveRelayContext } from '@concierge-kit/core';

export async function POST({ request }) {
  const upstream = await fetch(API, forwardRequestCookies(request, { method: 'POST' }, policy));
  const response = new Response(upstream.body, { status: upstream.status });
  relaySetCookies(upstream, response.headers, cookiePolicy, resolveRelayContext(request));
  return response;
}
```

어댑터가 더해 주는 유일한 것은 `'auto'` 규칙이 판단 근거로 쓰는 요청 컨텍스트입니다. 여기서는
직접 넘겨 주세요. 코어는 자기가 어떤 요청을 처리 중인지 프레임워크에 물어볼 수단이 없습니다.

## 상태

성숙도는 체크 표시가 아니라 테스트 수로 보고합니다.

| 모듈                                | 하는 일                                 | 테스트 | 성숙도                 |
| ----------------------------------- | --------------------------------------- | -----: | ---------------------- |
| `core/cookie/rewriteSetCookie`      | 원문 문자열 치환으로 속성 수정          |     18 | 믿고 씀                |
| `core/cookie/relaySetCookies`       | 백엔드에서 브라우저로, allow 적용       |     10 | 믿고 씀                |
| `core/cookie/forwardRequestCookies` | 브라우저에서 백엔드로                   |     10 | 믿고 씀                |
| `core/cookie/scanSetCookie`         | 치환의 바탕인 오프셋 스캐너             |      9 | 믿고 씀                |
| `core/cookie/splitSetCookie`        | `getSetCookie` 와 날짜를 아는 폴백      |      8 | 믿고 씀                |
| `core/cookie/matchCookie`           | matcher 형태와 OR 배열                  |      8 | 믿고 씀                |
| `core/context`                      | 요청 컨텍스트와 도메인 매칭             |      9 | 믿고 씀                |
| `core/policy/validate`              | 개발 시점 정책 검증                     |      9 | 믿고 씀                |
| `core/headers/hopByHop`             | 넘기면 안 되는 헤더                     |      4 | 믿고 씀                |
| `core/createRelay`                  | 인스턴스 배선                           |      4 | 믿고 씀                |
| 타입 좁힘 (`*.test-d.ts`)           | matcher 리터럴, 값 비노출               |      8 | 믿고 씀                |
| `next/apply`                        | 서버 액션 경로, `onUnappliable`         |      8 | 믿고 씀                |
| `next/route`                        | 패스스루 팩토리                         |      7 | 믿고 씀                |
| `next/respond`                      | 라우트 핸들러 경로                      |      6 | 믿고 씀                |
| `next/withRelay`                    | 핸들러 래퍼                             |      5 | 믿고 씀                |
| `next/cookieStoreInit`              | 쿠키 저장소용 속성 매핑                 |      5 | 믿고 씀                |
| `next/forward`                      | 암묵 요청 읽기                          |      2 | 쓸 수 있지만 확인 필요 |
| e2e, 실제 브라우저                  | Domain, Secure, SameSite, allow, 양방향 |     12 | 믿고 씀                |
| `core/node` 요청 컨텍스트           | `AsyncLocalStorage`. h3 전까지 미사용   |      0 | 얇음                   |
| h3 / Nuxt 어댑터                    |                                         |      0 | 없음                   |
| React 서버 컴포넌트                 |                                         |      0 | 없음                   |

합계는 코어 단위·타입 테스트 97개, Next 어댑터 통합 테스트 33개, 브라우저 e2e 12개입니다.

e2e 는 `localhost` 가 아니라 `dev.example.test` 에서 돕니다. 브라우저는 `localhost` 를
secure context 로 취급하므로 평문 http 에서도 `Secure` 쿠키를 저장하고 `Domain` 불일치도
드러나지 않습니다. 거기서 통과하는 스위트는 아무것도 증명하지 못합니다. 12개 중 6개는 의도적으로
순진한 릴레이를 쓰는 대조군이고, 브라우저가 쿠키를 버리는 것을 확인합니다.

## 이번 릴리스에 없는 것

요청 헤더 전파와 상관 ID, hop-by-hop 을 넘어서는 응답 헤더 필터, 내부와 외부 base URL,
리다이렉트 경로 정규화, 타임아웃과 재시도, 에러 정규화, 구조화 로깅, 그리고 미들웨어 어댑터.
각각이 현재 구조의 어디에 들어가는지는 `docs/design-memo.md` 에 적어 두었습니다.

다음 두 가지는 순서대로 미들웨어 어댑터와 Nuxt 용 h3 어댑터입니다. 앞의 것은 같은 렌더가 볼 수
있는 쿠키를 설정하는 유일한 방법이기도 합니다.

## 패키지

| 패키지                                 | 내용                                |
| -------------------------------------- | ----------------------------------- |
| [`@concierge-kit/core`](packages/core) | Web 표준만, 의존성 0, Edge 안전     |
| [`@concierge-kit/next`](packages/next) | Next.js App Router 어댑터, 15 와 16 |

## 개발

```sh
pnpm install
pnpm test        # 단위, 타입, 통합 테스트
pnpm typecheck   # 별도 게이트. 번들러는 타입을 검사하지 않고 지웁니다
pnpm build
pnpm --filter @concierge-kit/e2e exec playwright install chromium
pnpm e2e
```

`pnpm deps:check` 와 `pnpm unused:check` 가 의존성 버전 드리프트와 미사용 export 를 막습니다.
`next` 는 어댑터에서 15, 플레이그라운드에서 16 으로 일부러 다르게 고정해 두 메이저를 모두
실행합니다. 버전 일관성 검사에서 제외한 유일한 의존성입니다.

## 라이선스

MIT
