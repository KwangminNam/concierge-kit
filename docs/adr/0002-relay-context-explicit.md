# ADR-0002. `'auto'` 판정에 필요한 요청 정보를 `RelayContext` 인자로 명시한다

## 맥락

`secure: 'auto'` 는 현재 요청이 https 인지, `domain: 'auto'` 는 현재 host 가 쿠키 Domain 과
domain-match 하는지 알아야 판정할 수 있다. 코어는 프레임워크에 의존하지 않으므로 이를 스스로
알아낼 수단이 없다.

## 결정

`RelayContext { proto: 'http' | 'https'; host: string }` 를 순수 함수의 선택 인자로 받는다.
어댑터가 자동으로 채운다. 컨텍스트가 없으면 `'auto'` 는 **가장 안전한 쪽**으로 판정한다.
`secure` 는 유지(제거하지 않음), `domain` 은 유지.

## 근거

- 전역 상태나 AsyncLocalStorage 를 코어가 읽으면 Edge-safe 가 깨지고 테스트가 순수하지 않게 된다.
- 프로토콜 판정 순서는 `x-forwarded-proto` → 요청 URL 스킴이다. 컨테이너 안에서 요청 URL 은
  거의 항상 http 라 이 순서를 뒤집으면 배포 환경에서 `Secure` 가 통째로 벗겨진다.
- 컨텍스트 부재 시 "유지"를 택한 이유는, 쿠키가 안 붙는 실패보다 과하게 엄격한 쿠키가 낫기 때문이다.
  전자는 조용하고 후자는 재현이 쉽다.

## 결과

순수 함수 경로가 어댑터 경로보다 인자가 하나 많다. 이것이 헤드리스의 대가다.
