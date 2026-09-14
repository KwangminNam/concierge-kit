# ADR-0001. Route Handler 경로와 Server Action 경로를 명시 API 로 분리한다

## 맥락

백엔드의 Set-Cookie 를 브라우저까지 보내는 방법이 Next App Router 에 두 가지 있다.
Route Handler 는 응답 `Headers` 에 `append('set-cookie', raw)` 로 원문을 그대로 흘릴 수 있다.
Server Action 은 반환할 `Response` 객체가 손에 없어 `cookies().set()` 을 써야 한다.
하나의 함수가 호출 위치를 감지해 알아서 고르게 할 수 있는지 검토했다.

## 결정

감지하지 않는다. `relay.respond(upstream)` 과 `relay.apply(upstream)` 으로 나눈다.

## 근거

- 호출 위치 감지는 Next 의 비공개 내부 요청 스토어를 들여다봐야 한다. 메이저 버전마다 깨지는데,
  깨졌을 때의 증상이 "쿠키가 조용히 안 붙는다"라 최악이다.
- 두 경로는 능력이 다르다. `append` 는 동명이Path 쿠키 둘을 보존하지만 `cookies().set()` 은 name 키라
  하나가 덮인다. 능력 차이를 자동 선택 뒤에 숨기면 소비자가 왜 쿠키가 사라졌는지 알 수 없다.
- 이름이 다르면 타입도 다르게 줄 수 있다. `respond` 는 `Response` 를 반환하고 `apply` 는 `void` 에
  가깝다. 자동 선택은 반환 타입을 합쳐야 해서 둘 다 어색해진다.

## 결과

소비자가 두 이름을 배워야 한다. README 사용법 3종으로 상쇄한다.
`cookies().set()` 의 동명 쿠키 한계는 알려진 제약으로 문서화한다.
