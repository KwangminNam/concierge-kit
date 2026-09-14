# ADR-0004. hop-by-hop 헤더 제거를 v1 에 포함한다

## 맥락

응답 헤더 필터는 원래 백로그 항목이었다. 그러나 `relay.respond` 와 `relay.route` 가
upstream 응답 헤더를 그대로 복사하면 릴레이가 동작조차 하지 않는다.

## 결정

`content-encoding`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`,
`upgrade`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer` 를 v1 에서 제거한다.

## 근거

undici 의 `fetch` 는 응답 본문을 자동으로 압축 해제하지만 `content-encoding: gzip` 헤더는 남긴다.
이것을 그대로 브라우저에 전달하면 이미 해제된 본문을 다시 해제하려다
`ERR_CONTENT_DECODING_FAILED` 로 실패한다. `content-length` 도 해제 후 길이와 맞지 않는다.
백로그의 "응답 헤더 필터"는 정책 옵션으로 확장하는 일이고, 이 목록은 정책 이전의 정확성 문제다.

## 결과

`core/src/headers/` 모듈이 v1 부터 존재한다. 백로그의 응답 헤더 필터는 이 모듈에 옵션을 더하는 일이 된다.
