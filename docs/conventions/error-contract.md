# 백엔드 에러 응답 계약

> 이 문서는 GROMO-1657(공통 응답·예외 규약 통일)에서 확정한 **현재 상태**다. 계약을 지키는 테스트는
> `server/data-api/src/test/java/com/oneorthree/phone/common/exception/ErrorContractTest.java` 이고,
> 앱 쪽 분기는 `app/app-dev/src/services/groupApi.ts` 의 `groupErrorCode()` 가 대표다.

---

## 1. 봉투는 하나다

모든 실패 응답은 이 모양으로 나간다. 성공 응답은 이 문서의 범위가 아니다.

```json
{ "code": "NICKNAME_DUPLICATE", "message": "이미 사용 중인 닉네임입니다." }
```

| 필드 | 무엇 | 누가 읽나 |
| --- | --- | --- |
| `code` | 기계용 식별자. **에러코드 enum 상수의 이름 그대로**(`ErrorCode.name()`) | 앱이 `switch`/`===` 로 분기한다 |
| `message` | 사람이 읽는 문구. enum 에 적힌 문장 그대로 | 화면에 그대로 뜰 수 있다 |

**범위** — `DispatcherServlet` 이 라우팅하는 응답은 `GlobalExceptionHandler` 가, 그 **앞**의 필터 체인이
직접 쓰는 응답(`JwtFilter` 401 · `RequestSizeLimitFilter` 413)은 필터 자신이 같은 봉투를 손으로 맞춘다.
필터 쪽은 종전 모양 `{"error": "…"}` 의 `error` 필드를 **별칭으로 남긴 채** `code`·`message` 를 더한다 —
읽는 소비자는 확인된 바 없지만 빼면 계약 변경이다.

재시도 힌트가 필요한 실패 하나만 필드를 **더한다** — `RetryAfterErrorResponse.retryAfterMs`
(`RESULT_CLAIM_HELD`). 값은 **상대 지연(ms)**이지 절대 시각이 아니다. 봉투를 바꾸지 않고 상속으로
늘리는 것이 규칙이다 — 앱이 `code` 로 분기하고 있어 모양을 갈아 끼우면 기존 경로가 통째로 흔들린다.

**`code` 문자열은 계약이다.** 앱이 분기하는 코드가 2026-09-09 실측으로 27종이다(`NOT_FOUND`·
`MEMBER_ONLY`·`INSUFFICIENT_CURRENCY` …). 상수를 개명·삭제하면 앱의 그 분기가 **조용히** 빠진다 —
컴파일도 테스트도 잡지 못하고, 사용자는 공통 문구를 본다.

---

## 2. 어디서 나오나 — 타입이 계약을 묶는다

```
common/exception/ErrorCode          ← 인터페이스: name() · getStatus() · getMessage()
common/exception/DomainException    ← 추상 베이스: getErrorCode()
common/exception/GlobalExceptionHandler.handleDomain(DomainException)   ← 하나뿐
common/exception/CommonErrorCode    ← 도메인에 속하지 않는 실패(검증·파싱·404·405·락 충돌·500)

<domain>/exception/<Domain>ErrorCode   implements ErrorCode   (enum, HttpStatus + 문구)
<domain>/exception/<Domain>Exception   extends DomainException
```

`handleDomain` 은 판단하지 않는다 — `code.getStatus()` 를 상태로, `code.name()` 을 `code` 로,
`code.getMessage()` 를 `message` 로 옮길 뿐이다. **응답을 바꾸려면 핸들러가 아니라 그 도메인의 enum 을
고친다.**

### 왜 이렇게 됐나

2026-09-09 이전엔 enum 11개가 전부 `(HttpStatus, String)` 같은 모양인데 공통 타입이 없어서, 핸들러가
**글자 그대로 같은 메서드를 11개** 들고 있었다. 새 도메인이 생기면 핸들러에 한 줄을 더 붙여야 했고,
빠뜨리면 그 도메인 예외는 스프링 기본 `/error` 바디(`code` 없음)로 새어 나갔다. 그리고 그 11개를
직접 검증하는 테스트가 **0건**이었다.

계약을 타입으로 묶으면 핸들러는 하나로 족하고, **빠뜨릴 자리 자체가 없다.**

---

## 3. 새 도메인이 실패를 내려면

1. `<domain>/exception/<Domain>ErrorCode` — `implements ErrorCode`, 상수마다 `(HttpStatus, "문구")`
2. `<domain>/exception/<Domain>Exception` — `extends DomainException`, 생성자는 `super(errorCode)`
   하나. 자기 타입의 `errorCode` 필드를 두고 `getErrorCode()` 를 그 타입으로 좁혀 반환한다
   (호출부·테스트가 도메인 상수와 직접 비교하는 코드가 그대로 살게)
3. **`GlobalExceptionHandler` 는 손대지 않는다.** `ErrorContractTest.FACTORIES` 에 한 줄을 더한다 —
   안 더하면 그 테스트가 enum 이름을 지목하며 실패한다(손으로 적은 목록이 아니라 클래스패스에서
   찾기 때문에, 빠진 쪽이 드러난다)

**하지 말 것**
- 예외에 문구를 따로 주는 생성자 — 같은 code 가 호출부마다 다른 문장으로 나가고, 앱은 code 로만
  분기하니 감지도 안 된다
- 다른 도메인의 `ErrorCode` 를 빌려 쓰기 — 소유가 어긋나면 [[backend-layering]] §4 의 방향 규칙을
  어기게 된다. 필요하면 자기 enum 에 상수를 둔다
- 상수 이름 재사용 — `code` 는 이름 그대로라 두 enum 이 같은 이름을 쓰면 앱이 구분하지 못한다.
  현재 `NOT_FOUND` 가 `GroupErrorCode`·`UserErrorCode` 둘 다에 있고 의미가 다르다(GROMO-1725)

---

## 4. 상태 매핑 규칙

| 실패의 성격 | 상태 | 예 |
| --- | --- | --- |
| 지목한 대상이 없다 | 404 | `NOT_FOUND`, `BET_NOT_FOUND` |
| 요청자 본인의 계정이 없다(재로그인이 답) | 404 | `USER_NOT_FOUND` — 대상 부재와 **코드를 가른다**(GROMO-1247) |
| 입력이 틀렸다 | 400 | `NICKNAME_INVALID`, `INVALID_DATE_RANGE` |
| 권한이 없다 | 403 | `NOT_OWNER`, `GUEST_FORBIDDEN` |
| 지금 상태에선 안 된다 / 동시성 충돌 | 409 | `ALREADY_MEMBER`, `CONCURRENT_UPDATE` |
| 서버 배선 오류 | 500 | `LOGIN_USER_RESOLUTION_FAILED` — 재시도로 안 풀리는 유일한 계열 |

### 도메인 밖의 실패 — `CommonErrorCode`

프레임워크·인프라 예외는 도메인 예외로 던져지지 않으므로 전역 핸들러가 직접 봉투에 싣는다. 그 코드는
`common/exception/CommonErrorCode` 가 소유한다 — 종전엔 핸들러가 문자열을 손으로 박았고 낙관락 코드는
`GroupErrorCode` 를 빌려 써 `common → group` 참조가 있었다.

| 상황 | 상태 | code |
| --- | --- | --- |
| 토큰 없음·검증 실패 (필터) | 401 | `UNAUTHORIZED` — `error` 별칭 동반 |
| 요청 본문 상한 초과 (필터) | 413 | `PAYLOAD_TOO_LARGE` — `error` 별칭 동반 |
| `@Valid` 실패 · 깨진 JSON | 400 | `INVALID_REQUEST` (검증 실패는 DTO 애노테이션의 문구) |
| 파라미터 누락 · 타입 불일치 | 400 | `INVALID_PARAMETER` (문구에 파라미터 이름) |
| 타임존 id 해석 실패 | 400 | `INVALID_TIMEZONE` |
| 허용 안 된 메서드 | 405 | `METHOD_NOT_ALLOWED` |
| 받을 수 없는 `Content-Type` | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 만들 수 없는 `Accept` | 406 | `NOT_ACCEPTABLE` — **본문은 비어 나간다**: 클라이언트가 JSON 을 거부한 상태라 봉투를 쓸 수 없다. 상태 코드만이 계약이다 |
| 그 외 스프링 MVC 표준 예외 | 예외의 상태 | 4xx 는 `INVALID_REQUEST`, 5xx 는 `INTERNAL_ERROR` — `org.springframework.web.ErrorResponse` 구현체는 자기 상태를 지킨다(catch-all 로 500 이 되지 않는다) |
| 없는 경로 | 404 | `RESOURCE_NOT_FOUND` — **`NOT_FOUND` 가 아니다**(아래) |
| JPA `EntityNotFoundException` | 404 | `ENTITY_NOT_FOUND` — 도메인 코드로 치환되면 안 쓰인다(GROMO-895) |
| 잡히지 않은 `IllegalArgumentException` | 400 | `ILLEGAL_ARGUMENT` — 종전 409, GROMO-1725 에서 전환. 앱까지 닿던 raw 발급 3곳은 도메인 코드로 치환됐다 |
| DB 제약 위반 | 409 | `DATA_INTEGRITY_VIOLATION` |
| 낙관락·비관락 충돌 | 409 | `CONCURRENT_UPDATE` — 재시도하면 풀린다 |
| `@LoginUser` 배선 오류 | 500 | `LOGIN_USER_RESOLUTION_FAILED` |
| 그 외 전부 (catch-all) | 500 | `INTERNAL_ERROR` — 고정 문구, 원인은 로그로만 |

없는 경로에 `NOT_FOUND` 를 쓰지 않는 이유: 앱이 그 문자열을 「그룹이 사라짐」으로 해석하는 분기가
17곳이다. 오타 난 경로에 그 코드를 주면 엉뚱한 안내가 뜬다.

**같은 404 라도 탈출구가 다르면 코드를 가른다.** 대상 부재는 화면에서 처리할 일이고, 본인 계정 부재는
재로그인만이 답이다 — 한 코드로 뭉치면 앱이 멀쩡한 방장을 로그아웃시킨다.

---

## 5. 봉투 밖으로 새는 것 — 없다 (2026-09-09)

`GlobalExceptionHandler.handleUnexpected(Exception)` 이 catch-all 이라 스프링 기본 `/error` 바디로
새는 경로는 더 이상 없다. 핸들러가 닿지 않는 필터 체인의 두 응답(`JwtFilter` 401 · `RequestSizeLimitFilter`
413)도 같은 봉투를 직접 쓴다 — 이 둘은 `@RestControllerAdvice` 가 구조적으로 볼 수 없는 자리라
**핸들러를 고쳐서는 절대 봉투에 들어오지 않는다**. 새 필터가 응답을 직접 쓰면 `JwtFilter.envelope()` 를 쓴다. `UnhandledEnvelopeTest` 가 종전에 새던 일곱 경로(검증 실패·깨진 JSON·
파라미터 누락·405·404·`EntityNotFound`·catch-all)를 실제 디스패치로 고정한다.

**남은 것은 «코드가 맞는가»이지 «봉투에 실리는가»가 아니다** — 숨기지 않고 적는다.

| 무엇 | 지금 | 이관처 |
| --- | --- | --- |
| `IllegalArgumentException` 그물 | 해소 — 400 `ILLEGAL_ARGUMENT`(GROMO-1725). 앱 도달 3곳(집중 세션 시각 → `INVALID_DATE_RANGE`, 친구 검색 수단 → `INVALID_SEARCH_TYPE`, 소셜 제공자 → `UNSUPPORTED_PROVIDER`)은 도메인 코드로. 그물에 남은 raw throw 17건은 리포지토리·값객체 내부 가드 | 895 는 item·screentime 예외 신설만 남음 |
| `IllegalStateException` 25건 | catch-all 로 500 `INTERNAL_ERROR` — 종전엔 봉투도 없었다 | 프로그래밍 오류 계열이라 그대로 500 이 맞다. 입력 검증에 쓰인 것이 있으면 895 에서 치환 |
| item 의 `EntityNotFoundException` | 404 `ENTITY_NOT_FOUND` — 종전엔 500. 핸들러 도달 시 warn 이 남는다 | 도메인 코드(`ItemErrorCode`) 치환 → GROMO-895 |
| `NOT_FOUND` 두 도메인 중복 | 앱 17곳이 «그룹이 사라짐»으로 해석 | GROMO-1725 |
| 앱 죽은 분기 3종 | `CHALLENGE_NOT_FOUND`·`CHALLENGE_HAS_OPEN_BET`·`CHALLENGE_ALREADY_EXISTS` — 서버가 내지 않음 | GROMO-1725 |

---

## 6. 계약 테스트가 지키는 것

`ErrorContractTest` 는 목록을 손으로 적지 않는다 — `ErrorCode` 를 구현한 enum 을 **클래스패스에서 찾아**
상수마다 예외를 만들어 `handleDomain` 에 통과시키고 `(status, code, message)` 를 단언한다(2026-09-09
기준 117개 = 도메인 102 + `CommonErrorCode` 15 — GROMO-1725 에서 `INVALID_SEARCH_TYPE`·`UNSUPPORTED_PROVIDER` 추가). 그래서 잡히는 것:

- 핸들러가 `code.name()` 이 아닌 것을 `code` 로 싣는다 → 100건 실패 (실제로 넣어 확인)
- 도메인별 핸들러가 다시 생긴다 → 「하나뿐」 단언 실패 (실제로 넣어 확인)
- enum 이 `ErrorCode` 구현을 빠뜨린다 → `super(errorCode)` 가 컴파일되지 않는다
- 새 enum 이 팩토리 표에 없다 → 이름을 지목하며 실패

**잡히지 않는 것 하나** — `ErrorCode` 를 **enum 이 아닌 클래스**가 구현하면 `isEnum()` 필터에 걸러져
검사 대상에서 **조용히 빠진다**. §3 이 enum 만 허용하는 이유이고, 규칙을 어기면 그 구현체의 상수는
이 테스트가 보증하지 않는다.
