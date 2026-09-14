# conciergekit 설계 메모 (v1)

> 상태: 확정. 구현의 근거 문서.
> v1 범위는 **양방향 쿠키 릴레이 하나**. 그러나 패키지의 정체는 "쿠키 유틸"이 아니라
> **프론트엔드 서버 레이어(BFF)가 백엔드를 상대할 때 반복되는 잡음을 대신 처리하는 도구 모음**이다.

## 1. 이름

`conciergekit`. npm 패키지명과 `@conciergekit` 조직 scope 가 모두 비어 있고, GitHub 에 동명 저장소가 없다.

호텔 컨시어지는 손님의 요청을 받아 바깥 세계와 직접 처리하고 결과만 가져다준다. 손님은 그 바깥
세계와 한 번도 접촉하지 않는다. 브라우저가 백엔드의 존재를 모르는 이 패키지의 구조와 같은 관계다.
쿠키에 묶이지 않은 이름이라 §7 백로그(헤더 전파, 타임아웃, 리다이렉트 정규화, 로깅)가 전부
"컨시어지가 대신 처리해 주는 일"로 자연스럽게 들어온다. `-kit` 접미사는 라이브러리 성격을 드러낸다.

검토한 다른 후보와 탈락 사유:

| 후보                                      | 사유                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apidesk`                                 | 짧고 즉시 읽히지만 API 관리/문서화 제품으로 오해될 여지. 다루는 것은 API 가 아니라 서버 레이어      |
| `bffdesk`                                 | 레이어를 가장 정확히 지목하나 BFF 약어를 모르면 불투명                                              |
| `gobetween`                               | 의미는 완벽("직접 대화하지 않는 두 당사자 사이의 중개자")했으나 동명 Go 로드밸런서가 별 2천 개 규모 |
| `server-relay` / `batonpass` / `wallpass` | 사용 가능하지만 "편하게 해준다"는 뉘앙스가 없고 relay 는 GraphQL Relay 와 검색 충돌                 |

배포 스코프는 `@conciergekit/core`, `@conciergekit/next`. 저장소 루트는 `conciergekit`.
초기 버전은 `0.1.0`. 신규 패키지에 1.0 을 붙여 API 를 얼리지 않는다.

## 2. 계층

```
애플리케이션 (route handler / server action / middleware)
      │  relay.forward() · relay.respond() · relay.apply()
      ▼
@conciergekit/next                 프레임워크 어댑터 (얇음)
      │  framework.ts 만 next/headers 를 import 한다
      ▼
createRelay 인스턴스               정책 병합: 기본값 → 인스턴스 → 호출부
      │
      ▼
@conciergekit/core  cookie/ headers/ policy/    Web 표준만 안다. 의존성 0
```

- 코어가 아는 타입은 `Request`, `Response`, `Headers`, `RequestInit` 넷뿐이다. 프레임워크 import 금지,
  `node:` 접두 모듈 금지. 그래서 Edge 런타임과 SvelteKit·Hono 처럼 표준을 쓰는 곳에서 어댑터 없이 돈다.
- Node 전용 기능(AsyncLocalStorage 요청 컨텍스트)은 `@conciergekit/core/node` 서브패스로 격리한다.
  Edge 번들에서 import 만 해도 깨지는 일을 막는다.
- 패키지는 **기능이 아니라 통합 대상**으로 쪼갠다. 쿠키·헤더·타임아웃은 코어 안의 폴더다.
  어댑터가 늘어날 때만 패키지가 는다.
- 프레임워크 메이저 분기가 필요해지면 `@conciergekit/next-15` / `next-16` alias 서브패키지로 간다.
  그래서 어댑터의 프레임워크 API 접근 지점을 `framework.ts` 한 파일로 모았다. v1 은 분기 없음.

## 3. 공개 API

```ts
// 순수 함수 (어댑터 없이 완결)
relaySetCookies(from: Response | Headers, to: Headers, policy?: CookieRelayPolicy, ctx?: RelayContext): RelayResult
pipeSetCookies(from: Response | Headers, sink: (c: OutgoingSetCookie) => boolean | void, policy?, ctx?): RelayResult
forwardRequestCookies(from: Request | Headers, init?: RequestInit, policy?: ForwardPolicy): RequestInit
prepareResponseHeaders(headers: Headers): Headers   // hop-by-hop + 모든 Set-Cookie 제거
stripHopByHopHeaders(headers: Headers): Headers

// 인스턴스
const relay = createRelay({
  cookie: { allow: ['access_token', 'refresh_token'], domain: 'auto', secure: 'auto', sameSite: 'auto' },
  forward: { cookies: ['access_token', 'refresh_token'] },
  onUnappliable: 'warn',
})

// Next 어댑터
relay.forward(req?, init?)      // RequestInit. req 생략 시 headers() 로 컨텍스트 복원
relay.respond(upstream, init?)  // Route Handler. 응답 헤더 append 패스스루
relay.apply(upstream)           // Server Action. cookies().set()
relay.route(targetUrl, opts?)   // 순수 패스스루 팩토리 (재수출 한 줄)
withRelay(handler)              // HOF
```

`RelayResult` 는 `{ relayed: string[]; dropped: { name: string; reason: DropReason }[] }`.
**쿠키 값은 반환값·로그·에러 메시지·테스트 스냅샷 어디에도 실리지 않는다.** matcher 콜백에 넘기는
`SetCookieInfo` 에는 `value` 필드가 타입에 아예 없어서 실수로 찍는 경로를 컴파일 단계에서 막는다.

## 4. 원문 보존을 어떻게 구현하는가

Set-Cookie 를 파싱해 객체로 만들고 다시 굽지 않는다. **원문을 한 번 훑어 각 속성의 시작·끝 오프셋과
소문자 이름만 기록**하고, 손대야 하는 속성만 뒤에서 앞으로 잘라 붙인다.

```
sid=abc; Path=/; Domain=.example.com; Secure; SameSite=None; Partitioned
                 └────── splice ─────┘ └splice┘ └─ 치환 ─┘   └ 손 안 댐 ┘
```

코드가 모르는 속성은 존재 자체를 모르므로 바이트 그대로 남는다. `Partitioned`(CHIPS), `Priority`,
그리고 앞으로 생길 속성이 자동으로 보존된다. 손대는 속성은 `Domain`, `Secure`, `SameSite`, `Path` 넷뿐이다.

`set-cookie-parser` 는 의존성으로 쓰지 않는다. 쪼개기와 이름 추출은 자체 구현이 40줄이면 되고,
코어 의존성 0 목표가 더 가치 있다.

## 5. 원안에서 바꾼 것과 근거

| 항목               | 원안                       | 확정                        | 근거                                                                                                                                                             |
| ------------------ | -------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hop-by-hop 헤더    | v2 (§7 응답 헤더 필터)     | **v1 필수**                 | undici 는 body 를 자동 해제하면서 `content-encoding` 은 남긴다. 그대로 패스스루하면 브라우저가 `ERR_CONTENT_DECODING_FAILED`. 릴레이가 동작조차 못 함            |
| `domain` 기본값    | `'keep'`                   | `'auto'`                    | `keep` 은 로컬에서 조용히 실패한다. "동작하지만 위험한 기본값을 두지 않는다"에 어긋남. `auto` 는 요청 host 가 domain-match 하지 않을 때만 제거하므로 손해가 없다 |
| 두 경로 선택       | 자동 감지 가능성           | **명시 API 분리**           | 자동 감지는 Next 비공개 내부 스토어에 의존해야 하고 메이저마다 깨진다. ADR-0001                                                                                  |
| `forward`          | `{ cookies: true }` 불리언 | matcher 다형                | allowlist 원칙이 한 방향에만 걸리면 안 된다                                                                                                                      |
| `rename`           | `(name) => string`         | `{ toBrowser, toUpstream }` | 역방향 매핑이 없으면 이름을 바꾼 쿠키를 되돌려 보낼 수 없다                                                                                                      |
| `'auto'` 판정 입력 | 암묵                       | `RelayContext` 명시 인자    | 코어는 현재 요청을 물어볼 수단이 없다. ADR-0002                                                                                                                  |
| peer `next`        | `>=15`                     | `>=15` (15·16 모두 테스트)  | Next 16 이 이미 정식 배포됨                                                                                                                                      |
| `engines.node`     | 18.14+                     | `>=20.9`                    | Node 18 은 EOL. Next 16 요구사항과도 일치                                                                                                                        |

## 6. 미결 사항의 가안

- **`onUnappliable` 의 위치.** RSC 렌더 중 쿠키 set 불가는 React Server Components 고유 제약이다.
  SvelteKit 은 load 어디서든 `cookies.set()` 이 되고, Nuxt 는 SSR 렌더 중 응답 헤더 쓰기가 허용된다.
  따라서 프레임워크 중립 코어의 정책 타입에 두는 것은 순수하지 않다. **가안: 코어 정책에 두되
  "Next 어댑터만 해석한다"고 타입 JSDoc 에 명시**한다. 어댑터 옵션으로 내리면 `createRelay` 한 곳에서
  정책을 선언한다는 §2-B-2 가 깨지기 때문이다. h3 어댑터를 낼 때 재검토한다.
- **`legacyNames` read-fallback.** 타입에만 열어두고 v1 구현은 넣지 않는다. 실제 전환 사례가 생겨야
  올바른 모양이 나온다. 타입 자리를 미리 잡아 두는 것으로 충분하다.
- **`core/node` 요청 컨텍스트.** v1 Next 경로는 `headers()` 만으로 충분해서 쓰이지 않는다.
  h3·커스텀 서버를 위한 최소 구현만 두고 어댑터는 v2 에서 연결한다.

## 7. 백로그 수용성 점검

각 항목이 **코어 모듈 폴더 하나 + 어댑터 몇 줄**로 들어가는지 확인했다. 구조를 고쳐야 하는 항목은 없었다.

| 백로그                   | 들어갈 자리                                                                           | 확인                                                          |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 요청 헤더 전파           | `core/src/headers/forwardRequestHeaders.ts`. `forward` 정책에 `headers: Matcher` 추가 | 쿠키 forward 의 일반화. 같은 matcher 엔진 재사용              |
| 상관 ID                  | 위와 같은 모듈. 헤더 이름을 `forward.correlation.header` 로 설정 주입                 | 백엔드 계약마다 이름이 달라 하드코딩 금지                     |
| 응답 헤더 필터           | `core/src/headers/` 에 이미 v1 의 `stripHopByHopHeaders` 존재. 정책 옵션만 추가       | 모듈이 이미 있음                                              |
| 내부/외부 base URL       | `core/src/url/resolveBaseUrl.ts` + `createRelay({ baseUrl: { internal, public } })`   | 리다이렉트 절대 URL 조립이 `request.url` 을 못 믿는 문제 포함 |
| 리다이렉트 정규화        | `core/src/url/safeRedirectPath.ts`. `//evil.com` 차단                                 | 순수 문자열 함수. 코어에 완전히 들어맞음                      |
| RSC 렌더 가드            | v1 `onUnappliable` 의 일반화                                                          | 이미 존재                                                     |
| 타임아웃/재시도          | `core/src/timeout/`. `relay.forward` 가 만드는 `RequestInit` 에 `signal` 주입         | forward 가 이미 `RequestInit` 을 반환하므로 자리 있음         |
| 에러 정규화              | `core/src/error/`. Server Action 반환값 규칙                                          | 어댑터 쪽 비중이 큼                                           |
| 구조화 로깅              | `createRelay({ logger })` 훅. `RelayResult` 가 이미 값 없는 요약을 만든다             | redaction 키 목록은 정책에 추가                               |
| 스트리밍/SSE·multipart   | `relay.respond` 가 `upstream.body` 를 그대로 넘기므로 이미 통과. 테스트만 추가        | 구조 변경 불필요                                              |
| 미들웨어 런타임          | `packages/next` 에 `proxy.ts` 어댑터 추가                                             | 아래 참고                                                     |
| **선언적 서버 컴포넌트** | `@conciergekit/react` 신규 어댑터 패키지                                              | 아래 참고                                                     |

### 승격한 두 항목

**`proxy` 어댑터(구 middleware).** RSC 렌더 중 Set-Cookie 는 어떤 컴포넌트로도 해결되지 않는다.
유일한 해법은 미들웨어 계층에서 백엔드 토큰 갱신을 호출하고, 응답에 Set-Cookie 를 실으면서
동시에 들어오는 `cookie` 요청 헤더를 바꿔치기해 같은 요청의 RSC 가 새 토큰을 보게 하는 것이다.
양방향 릴레이를 한 지점에서 하는 일이라 이 패키지의 정체에 정확히 맞는다. 백로그 최상단.
Next 15 이하는 미들웨어 기본이 Edge 라 `globalThis` 가 Node 쪽과 별개이고 인스턴스 설정이 보이지
않는다. Next 16 은 `proxy.ts` 로 이름이 바뀌며 Node 런타임이 기본이라 이 함정이 사라진다.
어댑터를 낼 때 버전별 경고를 dev 에서 출력한다.

**`@conciergekit/react`.** 참고한 선언형 라이브러리의 성공 요인은 명령형 훅·경계를 JSX 로 바꾼 것이다.
RSC 대응물로 가치가 있는 것은 둘뿐이다. 쿠키 존재로 렌더를 가르는 `<Gate>`(보호 레이아웃마다
반복되는 `cookies()` 읽고 `redirect()` 하는 코드를 대체), 그리고 릴레이 정책으로 upstream 을 호출해
render-prop 으로 넘기는 `<Query>`. 코어는 프레임워크 무의존이라 JSX 를 담을 수 없고, React 서버
컴포넌트는 "통합 대상" 하나이므로 별도 어댑터 패키지가 맞는 자리다. 데이터 페칭 라이브러리로
커지지 않도록 "릴레이를 인지하는 컴포넌트" 이상으로 확장하지 않는 경계를 둔다.
Nuxt 쪽은 JSX 층이 성립하지 않는다. Vue 서버 컴포넌트는 실험 단계이고 Nuxt 의 선언 단위는
composable 이므로 대응물은 h3 어댑터 위의 `useRelay()` 다.

## 8. 구현 중 확정하거나 드러난 것

**`pipeSetCookies` 를 도입했다.** Route Handler 경로와 Server Action 경로가 같은 엔진을 써야
하는데, 두 경로의 목적지가 다르다(`Headers.append` 와 `cookies().set()`). 그래서 코어에
싱크 콜백을 받는 함수를 두고 `relaySetCookies` 는 그 위의 한 줄이 되었다. 부수 효과로 쿠키
원문이 반환값이 아니라 호출자가 준 콜백으로만 흐르게 되어 "값 미노출" 원칙이 더 단단해졌다.
싱크가 `false` 를 반환하면 `unappliable` 로 기록되며, 이것이 RSC 렌더 감지의 구현이다.

**RSC 렌더 감지는 사전 판별이 아니라 catch 기반이다.** `cookies().set()` 이 던지는 것을 잡아
`onUnappliable` 정책으로 넘긴다. Next 의 에러 메시지를 문자열로 매칭하지 않으므로 메이저가
바뀌어도 동작한다. 원래 에러는 `cause` 로 보존한다.

**`Request` 판별을 `'headers' in from` 으로 하면 안 된다.** Next 의 `headers()` 가 돌려주는
`ReadonlyHeaders` 가 자기 `headers` 필드를 가지고 있어서, 이 덕 타이핑은 헤더 객체를 요청으로
오인하고 엉뚱한 필드를 읽는다. 실제로 Server Action 경로가 이것 때문에 런타임에서 터졌고
e2e 가 잡아냈다. 판별은 `Request` 에만 있는 `url`, `Response` 에만 있는 `status` 로 한다.
회귀 테스트를 코어에 남겼다.

**오타난 정책 키는 dev 에서 throw 한다.** 제네릭 파라미터에는 초과 속성 검사가 걸리지 않아
TypeScript 가 `sameSitePolicy` 같은 오타를 잡지 못한다는 것을 타입 테스트로 확인했다. 값
수준의 오타(`domain: 'stripe'`)는 타입이 잡는다. 나머지는 시작 시점 런타임 검증으로 막는다.

**`allow` 정책은 순수 함수에서 선택 인자다.** 생략하면 아무것도 중계하지 않고 dev 에서 한 번
경고한다. 필수로 두는 안도 검토했으나, "옵션 미지정 시 가장 안전한 기본값" 원칙과 일관되게
생략 가능 + 안전한 동작으로 정했다.

## 9. 테스트와 게이트

- **단위(코어)**: 헤더 문자열 입출력. Expires 쉼표, 다중 쿠키, 따옴표 값, `Partitioned`/`Priority` 보존,
  Domain strip, Secure strip 에 따른 SameSite 강등, matcher 각 형태와 배열 OR, rename, 동명이Path 쿠키
  2개 보존, `getSetCookie` 없는 Headers 폴백, dev 검증 throw.
- **타입(`*.test-d.ts`)**: matcher 제네릭 좁힘, 정책 모순 조합 컴파일 에러, `SetCookieInfo` 에 `value` 부재.
- **통합(Next)**: Route Handler 응답 헤더, `relay.route` 패스스루의 status/body 보존, Server Action 경로,
  RSC 렌더 중 호출 시 `onUnappliable` 세 모드. `framework.ts` 를 mock 해 렌더 단계 에러를 재현한다.
- **e2e(Playwright)**: playground 앱 + 가짜 백엔드로 **브라우저가 실제로 저장했는가**를 검증.
  **중요: localhost 로는 검증이 안 된다.** 브라우저는 `localhost` 와 `127.0.0.1` 을 secure context 로
  취급해 http 에서도 `Secure` 쿠키를 저장한다. Domain 불일치도 재현되지 않는다. 그래서
  `--host-resolver-rules=MAP dev.example.test 127.0.0.1` 로 비-localhost 호스트를 쓴다.
- Next 15 와 16 은 CI 매트릭스로 함께 검증한다. 어댑터 devDependency 는 peer 하한인 15 에,
  playground 는 최신인 16 에 고정해 두 메이저가 실제로 돌아간다. 이 한 건만 의존성 버전
  일관성 검사에서 제외한다.
- CI 잡은 `lint` · `typecheck` · `test` · `build` · `e2e` 로 분리한다. **빌드 성공을 타입 안전의 증거로
  쓰지 않는다.** 번들러는 타입을 검사하지 않고 지운다. 여기에 더해 의존성 버전 일관성(sherif)과
  미사용 export(knip) 검사를 둔다.
