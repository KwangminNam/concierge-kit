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
pnpm add @concierge-kit/h3       # Nuxt, 또는 nitro·h3 서버
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

## 프록시만 할 수 있는 한 가지

라우트 핸들러가 쓰는 쿠키는 브라우저가 **다음** 요청에 실어 보냅니다. 서버 액션에는 응답 객체가
없습니다. 서버 컴포넌트 렌더는 쿠키를 아예 쓸 수 없습니다. 그래서 화면을 그리는 도중 토큰이
만료되면, 어떤 호출 지점도 토큰을 갱신하면서 그 갱신을 필요로 한 렌더에 보여줄 수 없습니다.

프록시는 할 수 있습니다. 요청이 도착한 뒤 렌더가 시작되기 전에 있는 유일한 계층이기 때문입니다.

```ts
// proxy.ts
import { relay } from '@/lib/relay';

export const proxy = relay.proxy({
  endpoint: `${API}/auth/refresh`,
  when: (request) => !request.cookies.has('access_token') && request.cookies.has('refresh_token'),
  onFailure: 'clear',
});

export const config = { matcher: ['/((?!_next|favicon.ico).*)'] };
```

응답은 브라우저용 `Set-Cookie` 를 싣고, 동시에 들어오는 `cookie` 헤더가 다시 쓰입니다. 그래서
뒤따르는 렌더가 이미 회전된 토큰을 읽습니다. e2e 스위트가 정확히 그것을 검증합니다. 서버
컴포넌트가 브라우저는 보낸 적 없는 값을 읽습니다.

손으로 쓰면 여기서 틀립니다. 둘 중 하나만 하면 반대 방향으로 조용히 실패하기 때문입니다. 요청만
다시 쓰면 브라우저에 쿠키가 저장되지 않습니다. 응답만 쓰면 이번 렌더는 백엔드가 방금 거부한
토큰을 계속 씁니다.

`when` 은 필수입니다. 조건이 없는 프록시는 모든 화면 이동마다 백엔드를 호출합니다. 실수로 도달할
기본값치고는 너무 비쌉니다. `onFailure: 'clear'` 는 브라우저와 진행 중인 요청의 세션을 한꺼번에
끝냅니다. 이미 거부된 토큰으로 렌더가 계속되지 않게 하기 위해서입니다.

직접 흐름을 짜고 싶으면 `rotateFromUpstream(relay, request, upstream)` 이 양쪽 쓰기만 해 주고
나머지는 맡깁니다.

이것이 `onUnappliable` 에 대한 답이기도 합니다. 지금 렌더가 볼 수 있는 쿠키가 필요하다면 어떤
호출 지점도 그것을 줄 수 없고, 줄 수 있는 계층이 바로 여기입니다.

## 요청 하나, 시간 예산 하나

백엔드 호출에는 타임아웃이 있습니다. 요청에는 없습니다. 그래서 화면을 그리며 부르는 세 번째
호출은, 앞의 두 호출이 사용자가 참을 시간을 거의 다 써 버렸어도 자기 타임아웃을 꽉 채워
기다립니다. 분산 시스템은 이것을 deadline propagation 으로 풉니다. 프론트 서버 층에는 그것이
없었습니다.

```ts
export const relay = createRelay({
  cookie: { allow: ['access_token'] },
  forward: { cookies: ['access_token'] },
  deadline: { budget: 3000 },
});
```

프록시가 요청이 들어오는 지점에서 예산을 찍고, 그 요청 동안 `relay.forward()` 가 만드는 모든
호출이 남은 것을 받습니다. 예산이 다하면 울리는 `AbortSignal` 과, 백엔드에게 몇 밀리초가 남았는지
알려주는 헤더입니다.

```ts
// 트리 깊은 곳의 서버 컴포넌트, 요청 시작 2.1초 후
const res = await fetch(`${API}/inventory`, await relay.forward());
// → x-request-deadline: 900, 백엔드가 늦으면 900ms 에 호출이 중단됨
```

부하 상황에서 실제로 무언가를 바꾸는 것은 백엔드 헤더 쪽입니다. 900 밀리초가 남았다고 들은
백엔드는 아무도 읽지 않을 답을 만드는 일을 멈출 수 있습니다. 헤더 이름은 설정할 수 있습니다.
표준이 아니라 백엔드와의 계약이기 때문입니다.

신호를 직접 쓰고 싶은 호출 지점은 `relay.deadline()` 으로 남은 것을 받습니다. 예산이 다한 뒤에는
신호가 이미 중단된 상태라, 늦은 호출은 쌓이지 않고 즉시 실패합니다.

예산은 요청의 단계 사이를 비동기 컨텍스트가 아니라 헤더로 건너갑니다. 쿠키와 같은 방식입니다.
Next.js 에서 프록시와 렌더는 별개의 컨텍스트라 한쪽에서 설정한 값이 다른 쪽에 보이지 않습니다.
e2e 스위트가 렌더가 프록시의 스탬프를 읽는 것을 검증합니다. h3 에서는 예산이 이벤트에 살고,
첫 호출 또는 `relay.stamp(event)` 를 부르는 `onRequest` 훅에서 시계가 시작됩니다.

프록시가 없으면 아무것도 찍히지 않습니다. `forward()` 는 예산을 적용하지 않고 개발 중에 한 번
알립니다. 프록시가 없는 것은 "데드라인 없음" 으로 내려가지 크래시가 되지 않습니다.

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

이 약속을 지키기 위한 보완이 둘 있습니다. 브라우저는 `localhost`, `*.localhost`, `127.*`,
`[::1]` 을 secure context 로 취급하므로 거기서는 `Secure` 를 벗기지 않고 그대로 둡니다. 그리고
`Secure` 가 벗겨질 때는 `Partitioned` 도 함께 벗깁니다. `Secure` 없는 `Partitioned` 쿠키는
거부되기 때문입니다. `__Host-` 나 `__Secure-` 접두 쿠키는 손대지 않고 개발 중에 알립니다. 벗기면
무효가 될 뿐입니다.

옵션이 제네릭인데도 모르는 키는 정책 한 단계 안까지 컴파일 에러입니다. `defineRelayOptions` 로
옵션을 별도 파일에 선언하면 리터럴 타입이 유지되어, `allow: ['a', 'b']` 가 나중에도 `relayed`
를 `('a' | 'b')[]` 로 좁힙니다.

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

## fetch 를 꼭 써야 하나요?

아닙니다. conciergekit 은 스스로 `fetch` 를 호출하지 않고, 여러분에게 요구하지도 않습니다.

`forward` 가 `RequestInit` 을 돌려주는 것은 대부분의 호출자가 원하는 모양이기 때문입니다.
하지만 그 안에서 conciergekit 이 관여하는 것은 `cookie` 헤더 하나뿐입니다. 그것만 꺼내서 어떤
클라이언트에든 넘기면 됩니다.

```ts
const init = forwardRequestCookies(request, undefined, { cookies: ['access_token'] });
const cookie = new Headers(init.headers).get('cookie');

await axios.get(url, { headers: { cookie } });
```

돌아오는 쪽에서 릴레이가 읽는 것은 `Response` 가 아니라 `Headers` 입니다. 쓰는 클라이언트가
어떤 모양으로 주든 거기서 `Headers` 를 만들면 됩니다.

```ts
const raw = response.headers['set-cookie']; // axios, node:http, got
const lines = Array.isArray(raw) ? raw : splitSetCookieString(raw ?? '');

const from = new Headers();
for (const line of lines) from.append('set-cookie', line);

relaySetCookies(from, outgoing.headers, policy, context);
```

두 번째 분기가 중요합니다. 여러 쿠키를 쉼표로 이어 붙인 문자열 하나로 주는 클라이언트가 바로
`splitSetCookieString` 이 존재하는 이유이고, 이 함수는 `Expires=Tue, 21 Oct 2025 ...` 안의
쉼표가 구분자가 아니라는 것을 압니다.

`examples/runtimes` 가 `node:http` 만으로, `fetch` 없이 이 전부를 검증합니다.

fetch 가 등장하는 유일한 곳은 Next.js 어댑터이고, 거기서도 선택은 여러분 몫입니다.
`relay.route()` 는 요청을 대신 보내 주지만, `relay.forward()` 와 `relay.respond()` 는 요청을
준비하고 응답을 읽을 뿐입니다.

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

// 또는 재수출 한 줄로
export default relay.route(`${API}/login`);
```

h3 어댑터는 Next.js 것보다 두 가지 면에서 단순합니다. 쓰기 경로가 둘이 아니라 하나입니다.
h3 핸들러는 언제나 응답 헤더를 추가할 수 있어서 쿠키가 항상 백엔드가 보낸 원문 그대로
전달됩니다. 그리고 `onUnappliable` 은 여기서 의미가 없습니다. 렌더 중에 쿠키를 쓸 수 없다는
React 서버 컴포넌트 규칙을 설명하는 옵션이고 Nuxt 에는 대응물이 없습니다.

`forward` 와 `apply` 는 동기입니다. h3 가 요청을 바로 건네주기 때문입니다. 비동기인 것은 응답을
보내는 `respond` 뿐입니다.

peer 는 `h3` 1.15 이상이고, Nuxt 4 가 nitropack 을 거쳐 쓰는 버전입니다. h3 v2 가 웹 표준으로
옮겨가면 어댑터의 파일 하나만 바뀝니다.

## 그 밖의 런타임

SvelteKit, Hono, Cloudflare Workers, Deno 는 어댑터가 아예 필요 없습니다. 핸들러가 이미 표준
`Request` 를 받고 표준 `Response` 를 돌려주기 때문입니다.
[어댑터 없이 쓰기](#어댑터-없이-쓰기) 를 보세요. `examples/runtimes` 가 그 경로를 실제로
실행합니다.

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

합계는 코어 단위·타입 테스트 135개, Next 어댑터 통합 테스트 57개, h3 어댑터 19개,
문서화된 런타임 레시피 6개, 브라우저 e2e 19개입니다.

e2e 는 `localhost` 가 아니라 `dev.example.test` 에서 돕니다. 브라우저는 `localhost` 를
secure context 로 취급하므로 평문 http 에서도 `Secure` 쿠키를 저장하고 `Domain` 불일치도
드러나지 않습니다. 거기서 통과하는 스위트는 아무것도 증명하지 못합니다. 12개 중 6개는 의도적으로
순진한 릴레이를 쓰는 대조군이고, 브라우저가 쿠키를 버리는 것을 확인합니다.

## 이번 릴리스에 없는 것

요청 헤더 전파와 상관 ID, hop-by-hop 을 넘어서는 응답 헤더 필터, 내부와 외부 base URL,
리다이렉트 경로 정규화, 재시도, 에러 정규화와 구조화 로깅.
각각이 현재 구조의 어디에 들어가는지는 `docs/design-memo.md` 에 적어 두었습니다.

다음은 h3 프록시입니다. nitro 를 통해 Nuxt 에도 같은 양방향 회전을 줍니다.

## 패키지

| 패키지                                 | 내용                                |
| -------------------------------------- | ----------------------------------- |
| [`@concierge-kit/core`](packages/core) | Web 표준만, 의존성 0, Edge 안전     |
| [`@concierge-kit/next`](packages/next) | Next.js App Router 어댑터, 15 와 16 |
| [`@concierge-kit/h3`](packages/h3)     | h3 및 Nuxt 어댑터                   |

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
