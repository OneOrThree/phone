# 챌린지 정책 — v2 델타

> **문서 세트 v2 · 상위 정본(`docs/prd/challenge/policy.md`)에 병합 대기(후속 티켓)**
> 여기 없는 조항은 전부 상위 정본이 정본이다. 세트 전체 설명은 [`README.md`](./README.md).

---

## ⚠️ 손대지 말 것 — 지우면 계약 파괴

**GROMO-1285("좀비 값 정리")를 집는 사람이 문서의 첫 줄로 읽어야 하는 항목이다.**
티켓 이름이 "정리"라 지우는 작업으로 읽히지만, **아래 두 값은 좀비가 아니다.**

### 1. `refundedCount` 버킷 — 좀비가 아니다 (되살아났다)

**결정**: `GroupBetSettlementSummaryResponse.refundedCount`와 그 집계 코드를 **남긴다.**

**근거**: 24시간 데드라인 자동 전원 환불(N21 · GROMO-1411)이 이 버킷을 다시 쓴다.
"상시 0인 레거시"였던 시절은 끝났다.

| 축 | 증거 |
|---|---|
| 채움 | `back/src/main/java/com/oneorthree/phone/group/service/GroupBetSettlementService.java:90-92` — `REFUNDED` 분기에서 `refunded++` |
| 채움 | 같은 파일 `:124-125` — 응답에 `refunded` 를 실어 반환 |
| 소비 | `back/src/main/java/com/oneorthree/phone/group/api/GroupBetBatchController.java:83` — 감사 로그에 `summary.refundedCount()` 출력 |
| 고정 | `back/src/test/java/com/oneorthree/phone/group/service/GroupBetSettlementServiceTest.java:98,108` — "24h 데드라인 자동 전원 환불(N21)은 refunded 버킷으로 따로 센다" 테스트가 `isEqualTo(1)` 로 못 박는다 |

`GroupBetSettlementService.java:90-92` 원문:

```java
} else if (result.status() == GroupBetStatus.REFUNDED) {
    // 24h 데드라인 자동 전원 환불(N21) — 몰수·분배와 구분해 집계한다.
    refunded++;
```

지우면 **테스트가 즉시 빨개지고**, 통과시키려고 테스트까지 지우면 24h 자동 환불의
유일한 관측 지점이 사라진다.

### 2. `BET_FOCUS_ONLY` **상수** — 의도적 잔존이 정본의 지시다

**결정**: `GroupErrorCode.BET_FOCUS_ONLY` **상수 자체는 남긴다.** 발급 경로가 없다는 것과
이름을 지워도 된다는 것은 다른 얘기다.

**근거**: 상위 정본 `docs/prd/challenge/low-level-design.md` **§2.2 「폐기되는 코드」**가 그렇게 지시한다. **이 배치가
정정한 뒤의** 현재 문면이다(정정 경위는 아래 ⚠️).

> **폐기되는 코드**: `BET_FOCUS_ONLY` 하나뿐이다. FOCUS 전용 게이트가 사라져 발생 경로가 없다
> (`GroupBetService.java:174` — 「게이트 = DURATION || (TIME_WINDOW && 창 목표분 있음). 카테고리 제한은 없다」).
> 값 자체는 **잔존**시킨다 — 구앱이 code 문자열로 분기하므로 이름을 지우지 않는다(발급만 멈춘다).

앱 쪽 소비처:

- `app/src/screens/group/components/BetSheet.tsx:515` — `case 'BET_FOCUS_ONLY':`
- `app/src/screens/group/components/BetSheet.test.tsx:891,893` — "구서버 `BET_FOCUS_ONLY`는 전용 문구로 알리고 닫는다"

설치된 구앱은 서버 응답의 `code` **문자열**로 분기한다. 상수 이름을 지우면 서버가 그 문자열을
영영 못 내보내고, 구앱은 분기 없는 일반 에러로 떨어진다. **정리 대상은 값이 아니라 서술이다.**

**⚠️ 정정 경위 — 종전 정본은 위험한 방향으로 틀려 있었다.** 저 문단은 원래
`BET_ALREADY_EXISTS` · `BET_CANCEL_FORBIDDEN` · `BET_CANCEL_HAS_OTHERS` 도 함께 나열하며
"개설·취소 개념이 사라지면서 **전부** 발생 경로가 없어진다"고 적었다. 셋 다 사실이 아니다 —
지금도 던져진다:

| 코드 | 발급 지점 |
|---|---|
| `BET_ALREADY_EXISTS` | `GroupBetService.java:193` · `:205` · `:572` |
| `BET_CANCEL_FORBIDDEN` | `GroupBetService.java:270` |
| `BET_CANCEL_HAS_OTHERS` | `GroupBetService.java:272` |

**이 배치가 정본 문면을 고쳤다.** 죽었다고 적힌 코드를 믿고 살아 있는 `throw` 경로를 지우는 것은
1285가 막으려는 사고(죽은 코드를 살아 있다고 광고)의 **정반대 방향**이고 더 위험하다.

### 3. B13의 실제 남은 범위 — 「서술 3곳」

**정정 대상**: 상위 정본 `docs/prd/challenge/policy.md`의 §9.2 배선표 P3 / B13 행이
아래처럼 적혀 있었다 — 티켓 본문은 스스로 철회했는데 정본이 안 따라온 상태였다.

```
| P3 | B13 | 좀비 값 정리 — `refundedCount`, `BET_FOCUS_ONLY` · **GROMO-1285** |
```

**이 배치가 그 행을 고쳤다.** 값은 둘 다 남는다. B13은 **값 삭제가 아니라 서술 정정**이고,
대상은 아래 3곳뿐이다.

| # | 자리 | 지금 뭐가 틀렸나 |
|---|---|---|
| 1 | `back/src/main/java/com/oneorthree/phone/group/api/GroupBetController.java:147` | 400 응답 OpenAPI `description`이 `BET_FOCUS_ONLY(집중 챌린지 아님)`을 **발급 가능한 에러로** 나열한다. 발급 경로가 없으므로 **OpenAPI 서술에서만 뺀다**(상수는 §2대로 유지) |
| 2 | `back/src/main/java/com/oneorthree/phone/group/dto/GroupChallengeResponse.java:100-101` | `nextSessionAt` javadoc이 "요일 반복(B1, GROMO-1260)이 이 base 에 없어 **당장은 매일 활성(= 내일)으로 계산된다** — `GroupBetService#repeatDaysOf` 시임이 배선점이다"라고 적혀 있다. 배선은 끝났다 — `GroupBetService.java:915`가 `RepeatSchedule.next(repeatDaysOf(challenge), today)` 를 실제로 탄다 |
| 3 | `back/src/main/java/com/oneorthree/phone/group/service/GroupBetSettlementService.java:43` | `/** 실패 요약 로그에 실을 **betId** 상한 … */` — 주석의 `betId`가 실제 변수·로그(`sessionIds`)와 어긋난다. 티켓 완료 조건이 지목한 자리다. 주석만 고치면 상수 이름(`FAILED_BET_ID_LOG_LIMIT`)과 다시 갈리므로 **상수도 함께** `FAILED_SESSION_ID_LOG_LIMIT` 으로 맞춘다(참조는 이 파일 안 4건뿐·package-private) |

> ⚠️ 같은 파일 `:122`의 `// refunded 버킷은 … (종전엔 상시 0 레거시).` 괄호도 좀비 프레이밍의
> 흔적이긴 하나 **틀린 서술은 아니다**(실제로 종전엔 상시 0이었다). 티켓 완료 조건이 지목한
> 자리도 아니므로 **위 3곳에 포함하지 않는다** — 손댈지는 별도 판단이다.

**왜 3곳인가**: 이 배치의 계약(§1 워크스트림 소유권)이 GROMO-1285에 넘긴 파일이 정확히
저 3개다 — `GroupBetController.java` · `GroupChallengeResponse.java` ·
`GroupBetSettlementService.java`. 값 삭제가 빠지면 남는 일은 각 파일의 서술 한 자리씩이다.

---

## §A5. 창 겹침 — **변경 없음**, 구현이 여기 맞춰진다

**결정**: 정책은 **한 글자도 바꾸지 않는다.** GROMO-1270은 새 정책을 세우는 작업이 아니라
**이미 확정된 §A5를 코드로 옮기는 작업**이다.

**왜 이걸 굳이 적나**: 구현 시점에 "그럼 15분은 어디서 나온 숫자냐"를 다시 논의하면
근거 없이 값이 흔들린다. 근거는 이미 정본에 있고, 그대로 인용해 둔다.

### 정본 원문 (`docs/prd/challenge/policy.md` **§A5**, verbatim)

> ### A5. 창의 겹침 — 요일 ∧ 시간대
>
> **창형끼리는 카테고리와 무관하게 겹칠 수 없고, 사이에 최소 15분 간격이 있어야 한다.**
> 단 **요일이 겹치지 않으면 시간대가 같아도 무방**하다.
>
> ```
> 겹침 판정 = (요일 교집합 ≠ ∅) ∧ (시간대 간격 < 15분)
> ```
>
> ```
> 월수금 09:00–12:00 집중   ██████
> 화목   09:00–12:00 폰금지        ██████   ✓  요일이 안 겹침
> 월수금 11:00–13:00 폰금지  ✗ 409  요일·시간대 모두 겹침
> 월수금 12:10–14:00 폰금지  ✗ 409  간격 10분 < 15분
> 월수금 12:15–14:00 폰금지  ✓
> ```
>
> **왜 카테고리 무관 전면 금지인가.** 09–12시에 집중 90분을 하면 그 시간 폰은 자연히 안 쓰게 된다.
> 두 목표가 사실상 **하나의 행동으로 동시 달성**되므로 중복 보상이다.
>
> **왜 15분 간격인가.** 창 A가 12:00에 끝나고 창 B가 12:00에 시작하면 경계의 측정이 양쪽 창에
> 섞인다. **스크린타임 창이 15분 눈금**이라 그보다 좁은 간격은 눈금 하나가 두 창에 걸친다 —
> 가장 거친 측정 단위를 기준으로 잡아야 어느 조합에서도 경계가 깨끗하다. 창 FOCUS의 5분 관용치도
> 이 안에 들어온다.

### 이 인용에서 놓치기 쉬운 두 가지

**1. 판정식의 부등호는 strict `<` 다.**

```
겹침 판정 = (요일 교집합 ≠ ∅) ∧ (시간대 간격 < 15분)
```

간격이 **정확히 15분이면 겹침이 아니다** → 허용. 정본 예시가 이걸 직접 못 박는다:
`월수금 12:15–14:00 폰금지  ✓` — 앞 창이 12:00에 끝나므로 간격 정확히 15분, 그런데 통과다.
`≤`로 구현하면 이 줄이 409가 되어 문서와 코드가 갈린다. 경계값 표는
[`low-level-design.md`](./low-level-design.md)에 있다.

**2. 요일 교집합이 비면 시간대는 아예 보지 않는다.**

`(요일 교집합 ≠ ∅)` 가 **선행 조건**이다. 요일이 안 겹치면 시간대가 완전히 동일해도 허용이다
(정본 예시 `화목 09:00–12:00 폰금지 ✓`). 지금 구현은 이 조건이 없어서 **요일 무관하게
시간대만으로** 판정한다 — 엄격한 쪽으로 보수적이라 안전하지만 정책보다 좁다.
현행 코드가 스스로 그렇게 선언한다 (`GroupChallengeService.java:615-616`):

```java
 * <p>한계(후속 GROMO-1270): 요일 교집합(요일이 안 겹치면 시간대가 같아도 무방)과 15분 간격 규칙은
 * 아직 반영 전이다 — 그때까지는 요일 무관하게 시간대만으로 겹침을 판정한다(엄격한 쪽으로 보수적).
```

**GROMO-1270이 끝나면 이 javadoc 문단도 함께 지워야 한다** — 남겨 두면 다음 사람이
"요일 교집합은 아직 미반영"이라고 읽는다.

### §9.2 배선표에서의 자리

상위 정본 `docs/prd/challenge/policy.md` **§9.2 배선표**:

```
| P1 | B8 | 겹침 검사에 요일 교집합 + 15분 간격 반영 (N4) · **GROMO-1270** |
```

이 행은 **정확하다.** 정정할 것 없다.
