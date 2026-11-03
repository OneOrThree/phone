# Business API JSON 응답 gzip: 적용 전후와 근거

2026-11-03 기준. [티켓 2734](https://romance.atlassian.net/browse/GROMO-2734)의 구현은
[phone PR #1569](https://github.com/OneOrThree/phone/pull/1569)에서 `main`에 병합됐다.
이 문서는 **코드에서 바뀐 전송 방식**과 **저장된 응답으로 계산한 압축 가능성**을 기록한다.
운영 앱의 전송량·지연 개선을 실측한 결과로 읽지 않는다.

## AS-IS → TO-BE

| 구분 | 적용 전 | PR #1569 병합 후 코드 |
| --- | --- | --- |
| Business API 오리진 | HTTP 응답 압축 설정 없음 | Spring Boot 내장 응답 압축 활성화 |
| 압축 조건 | 해당 없음 | `Accept-Encoding`이 gzip을 허용하고, `Content-Type`이 `application/json`이며, 원본 본문이 2048B 이상일 때 gzip |
| 작은 JSON·PNG | 원본 본문 | 원본 본문 |
| 압축된 응답 | 해당 없음 | `Content-Encoding: gzip`, `Vary: accept-encoding` |
| 앱까지의 전송 | Cloudflare 압축 여부를 확인하지 못함 | Cloudflare를 거친 최종 인코딩·크기 확인 필요 |

설정 정본은 [`server/business-api/src/main/resources/application.yml`](../../server/business-api/src/main/resources/application.yml)의
`server.compression`이다. 값은 `enabled: true`, `mime-types: application/json`,
`min-response-size: 2KB`다. `2KB`는 여기서 **2048바이트**다. Realtime의 HTTP·WebSocket 응답,
Data API의 직접 응답, 정적 이미지에는 이 Business API 설정이 적용되지 않는다.

## 변경 전 응답 크기: 어떤 요청이 대상인가

2026-10-20에 저장한 **10,000명 시험 fixture의 API preflight**에서 성공 응답의 `responseBytes`를
집계했다. 원본은 로컬 `loadtest/reports/retest-main-20261020-expanded/measurements/users-10000/api/preflight.json`,
분류 기록은 같은 디렉터리의 `fixture-response-scope-10000.json`이다. 두 파일은 `loadtest/reports/`에
보관된 로컬 자료로, 이 저장소의 추적 파일이 아니다. 원본 실행의 서버 SHA는
`971061dc679dbe1d5d96690c3cb3f218d03f67fd`이며, 조사 기록의 상태는
`complete_with_failures`다. 아래 집계는 **200 응답만** 사용했다.

| 표본 범위 | 값 |
| --- | ---: |
| Business API 엔드포인트 관측 행 / 서로 다른 경로 | 62행 / 56경로 |
| Business API 200 응답 표본 | 186개, 원본 본문 합계 383,796B |
| 2048B 이상 표본 | 60개(32.3%), 원본 본문 합계 340,987B(88.8%) |
| 2048B 미만 표본 | 126개, 원본 본문 합계 42,809B |
| 한 번이라도 2048B 이상인 Business API 경로 | 16경로 |

| Business API 응답 예시 | 표본의 원본 크기 |
| --- | ---: |
| `/screens/mailbox` | 15,398–16,752B |
| `/islands/{islandId}/statistics/focus` (`scope=island`) | 12,067–12,381B |
| `/islands/{islandId}/messages` | 8,066–9,541B |
| `/islands/{islandId}/statistics/focus` (`scope=me`) | 5,881–5,896B |
| `/screens/home` | 3,842–3,878B |
| `/rankings/islands` | 3,648B |
| `/screens/library` | 2,508–3,177B |

같은 경로가 여러 시나리오에 반복돼 행·표본에 중복이 있다. 사용자별 요청 빈도로 가중한
운영 트래픽이 아니므로 **32.3%를 전체 요청의 압축 적용률**, **88.8%를 전체 트래픽의 절감률**로
해석하면 안 된다. 이 수치는 선택한 표본에서 크기 기준이 어느 본문에 걸리는지만 보여준다.
원본에는 Realtime 표본 6개도 있으나 위 Business API 집계에서 제외했다. 예를 들어
`/api/v1/chat/rooms/{islandId}/messages`의 8,806–10,371B는 이번 변경으로 압축되지 않는다.

## 저장된 본문의 로컬 gzip 결과

별도 2026-10-20 가입 가능 섬 조사에서 저장한 실제 JSON 본문을 UTF-8로 직렬화하고,
로컬 Python `gzip.compress`로 압축했다. 각 묶음은 세 응답 표본이다. 원본은 로컬
`loadtest/reports/retest-main-20261020-joinable30/responses/measured-*.json`이며 추적 파일이 아니다.
직렬화한 본문 길이가 저장된 `responseBytes`와 같은 것을 확인했다.

| 응답 | 원본 크기 | 로컬 gzip 크기 | 표본 합계 기준 절감 |
| --- | ---: | ---: | ---: |
| `/islands` 첫 페이지(3개) | 8,130–8,131B | 1,258–1,277B | 84.4% |
| `/islands` 다음 페이지(3개) | 3,870B | 629B | 83.7% |
| `/me/telescope`(3개) | 1,994–1,996B | 497–508B | 74.9% |

`/me/telescope`는 압축 자체는 잘되지만 **2048B 미만이어서 이번 설정에서는 압축하지 않는다.**
이 결과는 저장된 세 응답의 압축 가능성을 보여준다. Tomcat의 gzip 출력 크기나
Cloudflare를 거쳐 앱에 도착한 바이트 수와 동일하다고 가정하지 않는다. 본문이 보관되지 않은
메일함·통계 응답에는 이 압축률을 대입하지 않는다.

## 검증 상태와 아직 모르는 성과

[`ResponseCompressionTest`](../../server/business-api/src/test/java/com/oneorthree/business/ResponseCompressionTest.java)는
로컬 임베디드 Tomcat에 HTTP 요청을 보내 2047B JSON은 원본, 2048B JSON은 gzip임을 확인한다.
gzip 해제 후 본문 일치, `Accept-Encoding: identity`의 비압축 응답, `Vary` 헤더,
4096B PNG의 비압축도 확인했다. Business API 전체 331개 테스트와 `checkstyleMain`·`spotbugsMain`,
PR의 적용 CI가 통과했다. 이 검증에는 운영 API 요청이 포함되지 않았다.

다음 값은 아직 **미측정**이다: 실제 앱 요청의 `Accept-Encoding`, 운영 Cloudflare가 이미 적용하는
압축, 최종 수신 바이트, 응답 시간 변화, 오리진 CPU 비용. 앱의 공통 `fetch` 클라이언트는
`Accept-Encoding`을 직접 지정하지 않으므로 기기 네트워크 스택의 협상 결과를 코드만으로
확정하지 않는다. PR 병합과 CI 통과를 운영 배포·사용자 체감 성과로 취급하지 않는다.

AWS 부하 테스트·부하용 데이터 생성 금지 지침에 따라 운영 부하 재측정은 수행하지 않는다.
후속 확인이 필요하면 이미 수집된 헤더·로그·메트릭을 읽기 전용으로 분석하거나 AWS에
요청하지 않는 로컬 격리 환경에서 확인한다.
