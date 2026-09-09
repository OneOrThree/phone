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

**같은 404 라도 탈출구가 다르면 코드를 가른다.** 대상 부재는 화면에서 처리할 일이고, 본인 계정 부재는
재로그인만이 답이다 — 한 코드로 뭉치면 앱이 멀쩡한 방장을 로그아웃시킨다.

---

## 5. 아직 봉투 밖으로 새는 것 (숨기지 않고 적는다)

| 무엇 | 지금 | 이관처 |
| --- | --- | --- |
| `@Valid` 실패 (컨트롤러 26곳) | `MethodArgumentNotValidException` 핸들러가 없어 스프링 기본 바디, `code` 없음 | GROMO-1657 후속 PR |
| 깨진 JSON 바디 | `HttpMessageNotReadableException` 미처리 | GROMO-1657 후속 PR |
| 어디서도 안 잡힌 예외 | catch-all 없음 → 500 기본 바디 | GROMO-1657 후속 PR |
| `EntityNotFoundException` (item) | 매핑 없음 → **500** (404 여야 함) | GROMO-895 |
| `IllegalArgumentException` 그물 | 409 + `e.getMessage()` 반사. 이 그물에 걸리는 raw `IllegalArgumentException` 은 **21건**(throw 20 + 람다 1). 참고로 전 타입 raw 예외는 47건이지만 `IllegalStateException` 25건은 이 그물이 아니라 catch-all 부재로 500 이 된다 | 반사 제거는 1657 후속 PR, 400 전환은 GROMO-1725, 치환은 GROMO-895 |
| `NOT_FOUND` 두 도메인 중복 | 앱 17곳이 «그룹이 사라짐»으로 해석 | GROMO-1725 |
| 앱 죽은 분기 3종 | `CHALLENGE_NOT_FOUND`·`CHALLENGE_HAS_OPEN_BET`·`CHALLENGE_ALREADY_EXISTS` — 서버가 내지 않음 | GROMO-1725 |

---

## 6. 계약 테스트가 지키는 것

`ErrorContractTest` 는 목록을 손으로 적지 않는다 — `ErrorCode` 를 구현한 enum 을 **클래스패스에서 찾아**
상수마다 예외를 만들어 `handleDomain` 에 통과시키고 `(status, code, message)` 를 단언한다(2026-09-09
기준 100개). 그래서 잡히는 것:

- 핸들러가 `code.name()` 이 아닌 것을 `code` 로 싣는다 → 100건 실패 (실제로 넣어 확인)
- 도메인별 핸들러가 다시 생긴다 → 「하나뿐」 단언 실패 (실제로 넣어 확인)
- enum 이 `ErrorCode` 구현을 빠뜨린다 → `super(errorCode)` 가 컴파일되지 않는다
- 새 enum 이 팩토리 표에 없다 → 이름을 지목하며 실패

**잡히지 않는 것 하나** — `ErrorCode` 를 **enum 이 아닌 클래스**가 구현하면 `isEnum()` 필터에 걸러져
검사 대상에서 **조용히 빠진다**. §3 이 enum 만 허용하는 이유이고, 규칙을 어기면 그 구현체의 상수는
이 테스트가 보증하지 않는다.
