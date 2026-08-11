# 챌린지 상세 설계 — v2 델타 (GROMO-1270 창 겹침 판정)

> **문서 세트 v2 · 상위 정본(`docs/prd/challenge/low-level-design.md`)에 병합 대기(후속 티켓)**
> 여기 없는 설계는 전부 상위 정본이 정본이다. 세트 전체 설명은 [`README.md`](./README.md).
> 정책 근거는 [`policy.md`](./policy.md) — **정책은 변경 없다.**

---

## 1. 구현 계약 — `conflicts()`

**결정**: 아래 코드가 GROMO-1270의 **구현 계약**이다. 상위 정본
`docs/prd/challenge/low-level-design.md` **§3.6** 에 이미 적혀 있고, 구현은 이걸 옮긴다.

### 정본 원문 (`docs/prd/challenge/low-level-design.md` **§3.6**, verbatim)

> ### 3.6 창 겹침 판정 — 요일 ∧ 시간대 ∧ 15분 간격
>
> ```java
> static final int GAP_SECONDS = 15 * 60;
>
> // 창은 자정을 걸치지 않으므로 [시작, 끝) 초 구간이 **항상 하나**다
> static int[] daySegment(LocalTime start, LocalTime end) {
>     return new int[]{start.toSecondOfDay(), end.toSecondOfDay()};   // start < end 보장
> }
>
> static boolean conflicts(int maskA, LocalTime sA, LocalTime eA,
>                          int maskB, LocalTime sB, LocalTime eB) {
>     if ((maskA & maskB) == 0) return false;              // 요일이 안 겹치면 무조건 OK
>     int[] a = daySegment(sA, eA), b = daySegment(sB, eB);
>     // 15분 간격까지 요구 — 양쪽으로 GAP만큼 부풀려 겹침 검사
>     return a[0] - GAP_SECONDS < b[1] && b[0] - GAP_SECONDS < a[1];
> }
> ```
>
> **자정 걸침 금지가 이 함수를 절반으로 줄인다.** 걸치는 창을 허용하면 한 창이 `[s, 86400)` +
> `[0, e)` **두 구간**으로 쪼개져 2×2 중첩 루프가 필요했고, 거기에 "`D+1 00:00~01:00` 부분은
> 회차일 D의 몫이라 요일 마스크는 D 기준으로만 비교해야 한다"는 주의사항이 따라붙었다.
> 지금은 **구간 하나 대 구간 하나**의 단순 비교이고, 요일 마스크가 어느 날 것인지 되물을 일도 없다.

### 지금 코드와의 차이

현행 `GroupChallengeService.windowsOverlap` (`back/src/main/java/com/oneorthree/phone/group/service/GroupChallengeService.java:630-633`):

```java
private static boolean windowsOverlap(LocalTime aStart, LocalTime aEnd,
        LocalTime bStart, LocalTime bEnd) {
    return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
}
```

| 축 | 지금 | 계약 |
|---|---|---|
| 요일 | **안 본다** — 요일 무관 시간대만 비교 | `(maskA & maskB) == 0` 이면 **즉시 false** |
| 간격 | 없음 — 맞닿음(끝==시작)은 통과 | 양쪽 `GAP_SECONDS`(900) 만큼 부풀려 비교 |
| 부등호 | `isBefore` (strict) | `a[0] - GAP < b[1] && b[0] - GAP < a[1]` (strict) |

**부등호가 strict인 것이 정책의 핵심**이다 — §A5 예시 `월수금 12:15–14:00 ✓` 가
간격 **정확히 15분을 허용**으로 못 박는다. `<=` 로 구현하면 그 줄이 409가 되어 문서와 코드가 갈린다.

---

## 2. 경계값 표 — 요일 교집합 × 간격

**기준 상황**: 그룹에 활성 창형 A = `월수금 09:00–12:00` 이 이미 있고, B를 새로 만든다.
`gap` = A의 끝(12:00)과 B의 시작 사이 간격(분). 판정은 A·B의 카테고리와 무관하다(§A5).

### 2-1. 요일 교집합이 **있을 때** (B = 월수금 또는 월 등, A와 최소 1일 공유)

| # | B의 시각 | gap | 기대 | 왜 |
|---|---|---|---|---|
| E1 | `11:00–13:00` | (구간이 실제로 겹침) | **409** `CHALLENGE_WINDOW_OVERLAP` | 정본 §A5 예시 3행 |
| E2 | `12:00–14:00` | **0분** | **409** | 맞닿음도 간격 0 < 15 라 거부. **현행 구현은 통과시킨다 — 이번에 바뀌는 동작** |
| E3 | `12:10–14:00` | **10분** | **409** | 정본 §A5 예시 4행 (`간격 10분 < 15분`) |
| E4 | `12:14–14:00` | **14분** | **409** | 15분 미만 |
| E5 | `12:15–14:00` | **15분** | **허용** | **경계** — strict `<` 이므로 15분은 겹침이 아니다. 정본 §A5 예시 5행 |
| E6 | `12:16–14:00` | **16분** | **허용** | 15분 초과 |

### 2-2. 요일 교집합이 **없을 때** (A = 월수금, B = 화목)

| # | B의 시각 | gap | 기대 | 왜 |
|---|---|---|---|---|
| N1 | `09:00–12:00` (완전 동일) | (구간 완전 일치) | **허용** | `(maskA & maskB) == 0` → 즉시 false. 정본 §A5 예시 2행 |
| N2 | `11:00–13:00` | (구간이 실제로 겹침) | **허용** | 위와 같음 — 시간대는 아예 보지 않는다 |
| N3 | `12:00–14:00` | 0분 | **허용** | 위와 같음 |
| N4 | `12:10–14:00` | 10분 | **허용** | 위와 같음 |
| N5 | `12:14–14:00` | 14분 | **허용** | 위와 같음 |
| N6 | `12:15–14:00` | 15분 | **허용** | 위와 같음 |
| N7 | `12:16–14:00` | 16분 | **허용** | 위와 같음 |

**2-2가 전부 「허용」인 것이 요점이다.** 요일 교집합 검사가 **선행 게이트**라 시간대 축은
평가조차 되지 않는다. 표의 7행이 전부 같은 결과인 게 정상이고, 하나라도 409면 게이트가
안 걸린 것이다.

### 2-2-bis. ⚠️ 알려진 빈틈 — 자정 경계를 넘는 인접 (**막지 않기로 확정** · 2026-08-11 재영님)

판정식은 **같은 날짜 안의 선형 구간**만 비교한다. 그래서 아래 조합이 통과한다.

| A (매일) | B (매일) | 같은 날 기준 간격 | 판정 | 실제 인접 |
|---|---|---|---|---|
| `23:50–23:59` | `00:00–00:10` | 23시간 40분 | **허용** | 월 A 종료 ↔ **화** B 시작 = **1분** |

**구현 결함이 아니라 §A5 자체가 이 경우를 안 덮는다.** 정본 §3.6이 그 단순화를 의도적으로
택했다 — "자정 걸침 금지가 이 함수를 절반으로 줄인다 … 지금은 **구간 하나 대 구간 하나**의
단순 비교이고, 요일 마스크가 어느 날 것인지 되물을 일도 없다". 요일 회전(`d±1`)을 넣으면
GROMO-1406이 걷어낸 2구간 전개가 다른 형태로 돌아온다.

**두 근거 중 하나는 실제로 안 깨진다 — 다만 이유는 자정 리셋이지 눈금 정렬이 아니다.**

⚠️ **초판의 논증은 틀렸다.** *"눈금이 `:00/:15/:30/:45` 에 정렬되므로 두 창이 다른 눈금 안"* 이라고
적었는데 **그런 벽시계 눈금은 없다.** 실제 측정(`app/ios/gromo/ScreenTimeModule.swift`):

```swift
let step = 15
while m <= maxMinutes {
    threshold.hour = m / 60; threshold.minute = m % 60
    events["gromo.usage.bucket.\(m)"] = DeviceActivityEvent(..., threshold: threshold)
    m += step
}
```

threshold 는 **하루 누적 사용량**(15·30·45…분을 *썼는가*)이지 시각(*언제인가*)이 아니다. 익스텐션은
도달한 임의 시각을 `firedAt` 으로 기록하므로 발화 시점은 벽시계에 정렬되지 않는다.

**그럼에도 결론은 산다 — 근거가 바뀔 뿐이다.** 같은 파일의 스케줄이
`intervalStart 00:00 · intervalEnd 23:59 · repeats: true` 라 **누적이 자정에 리셋된다.**
`23:50–23:59`(월) 사용분과 `00:00–00:10`(화) 사용분은 **애초에 다른 날의 누적**이라 한 눈금에
섞일 수 없다. 오히려 자정은 측정 분리가 **보장되는** 유일한 경계다.

**⚠️ 단, 그 보장은 기기 타임존이 KST 일 때만이다.** 창은 KST 고정인데 누적 리셋·날짜 키는
**기기 로컬 자정** 기준이다(`app/src/services/screentimeSync.ts` 의 축 분리 주석 — 창 경계와
보고 date 는 KST 앵커, 조회 dayKey 와 세그먼트 경계만 로컬 축). 해외 기기에서는 KST 자정이
로컬 자정이 아니라 **두 KST 창이 같은 로컬-일 누적 안에 들어간다.**

**중복 보상 근거는 그대로 살아 있다 — 오히려 이쪽이 핵심이다.** §A5 가 금지하는 것은 「회차가
겹치는 것」이 아니라 **「하나의 행동으로 두 목표를 동시 달성해 두 번 보상받는 것」**이다. 같은 날
겹치는 두 챌린지도 각각 별개 회차인데 §A5 는 그걸 금지한다 — 회차가 다르다는 사실은 면죄부가
아니다. 매일 FOCUS `23:50–23:59`(6분 목표)와 `00:00–00:10`(6분 목표)를 두면 **끊기지 않은 한
번의 집중**이 양쪽 목표에 기여해 보상이 둘 나온다.

> **📌 2026-08-11 2차 정정.** 이 문단은 한때 *"서로 다른 두 날의 회차라 한 회차가 두 번 보상받는
> 구조는 아니다"* 라고 적었다. **틀렸다** — 판정 기준은 회차 동일성이 아니라 행동 동일성이다.
> 정본 §A5 각주와 같은 결론이다(그쪽이 정본).

**결정 — 막지 않는다 (2026-08-11 · 재영님).** 판정식은 지금 그대로다.

막으려면 `86400`초 이동 구간 + 요일 마스크 회전(`d±1`)이 필요하고, 그건 GROMO-1406이 걷어낸
2구간 전개를 다른 형태로 되살린다 — 판정식이 **"구간 하나 대 구간 하나"** 라는 성질을 잃는
대가가 실제 도달 빈도에 비해 크다는 판단이다.

**받아들이는 것**: 자정 양옆 조합에서 중복 보상이 가능하고, 해외 기기에서는 측정 근거까지
깨진다. **되돌리려면** `conflicts()` 에 `±86400` 이동 구간과 회전 마스크 비교를 넣고 위
경계값 표를 그에 맞게 확장한다 — 이 절이 그때의 출발점이다.

도달 가능성 자체가 낮지는 않다(창 4개 상한 안에서 자정 양옆 배치는 만들 수 있다).
**빈틈은 실재하고, 다만 알고 받아들인 것이다.** 정본 §A5에 같은 결정이 기록돼 있다.

> 출처: PR #610 codex 리뷰(2026-08-11). 답글에 같은 분석을 남겼다.

### 2-3. B가 A **앞에** 오는 대칭 케이스

판정식은 대칭이지만, 구현이 한쪽 방향만 부풀리는 실수를 하면 여기서 드러난다.

| # | B의 시각 (A = 월수금 09:00–12:00, 요일 겹침) | gap | 기대 |
|---|---|---|---|
| S1 | `07:00–08:44` | **16분** | **허용** |
| S2 | `07:00–08:45` | **15분** | **허용** (경계) |
| S3 | `07:00–08:46` | **14분** | **409** |
| S4 | `07:00–09:00` | **0분** | **409** |

---

## 3. 구현 주의 — 조사에서 나온 함정 2건

### 3-1. `findActiveByGroupForUpdate`는 `JOIN`이지 `JOIN FETCH`가 아니다 (N+1)

**문제**: 겹침 판정에 **요일 마스크가 새로 필요해진다.** 그런데 마스크는 창 상세
(`GroupChallengeWindow`)가 아니라 부모 `GroupChallenge`가 들고 있다.

현행 쿼리 (`back/src/main/java/com/oneorthree/phone/group/repository/GroupChallengeWindowRepository.java:29-35`):

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT w FROM GroupChallengeWindow w"
        + " JOIN w.challenge c"
        + " WHERE c.group = :group"
        + " AND c.status = 'ACTIVE'"
        + " AND c.deletedAt IS NULL")
List<GroupChallengeWindow> findActiveByGroupForUpdate(@Param("group") Group group);
```

`JOIN`은 **필터 조건일 뿐 부모를 함께 싣지 않는다.** 그리고 연관은 지연 로딩이다
(`back/src/main/java/com/oneorthree/phone/group/domain/GroupChallengeWindow.java:34`):

```java
@OneToOne(fetch = FetchType.LAZY)
```

그래서 `rejectWindowOverlap` 루프에서 `existing.getChallenge().getRepeatDays()` 를 읽으면:

1. **N+1** — 활성 창형 수만큼 `SELECT group_challenges` 가 추가로 나간다. 활성 상한이 4라
   최대 4회지만, 겹침 검사는 창형 생성마다 도는 경로다.

**해결(둘 중 하나)**:

- `JOIN` → **`JOIN FETCH`** 로 바꿔 부모 컬럼을 같은 쿼리에 싣는다, 또는
- **`(repeatDays, windowStart, windowEnd)` 프로젝션**으로 필요한 3값만 뽑는다.

`JOIN FETCH` 를 택하면 반환 타입이 유지돼 소프트딜리트 제외 회귀 테스트를 안 건드리고,
서비스 테스트가 실물 엔티티로 프로덕션과 같은 모양을 태울 수 있다(시임 우회 금지).

**⚠️ 이건 성능 이유지 정합성 구멍을 막는 게 아니다.** 이 문서 초판은 두 번째 이유로
「`FOR UPDATE` 락 범위 밖 읽기 — 락이 판정에 실제로 쓰이는 값에는 적용되지 않는다」를
적었는데 **과장이었다.** 근거 셋:

1. **`repeatDays` 는 생성 이후 갱신 경로 자체가 없다**(챌린지 수정 API 없음 — §A7).
   **잠금 범위가 무엇이든 값이 변할 수 없다.** 이 하나로 충분하다.
2. 이 PR 이전에도 `WHERE` 절이 `c.status` · `c.deletedAt` 을 읽고 있었다. `JOIN` → `JOIN FETCH`
   는 **읽는 대상을 늘리지 않는다** — 같은 값을 왕복 없이 가져올 뿐이다. 즉 이 변경이
   **노출을 새로 만들지도, 없애지도 않는다.**

⚠️ **부모 행이 실제로 잠기는지는 확인하지 못했다 — 어느 쪽으로도 단정하지 마라.**
`@Lock(PESSIMISTIC_WRITE)` 의 JPA 계약(`PessimisticLockScope.NORMAL`)은 **조회 루트에만** 걸린다.
Hibernate 가 `FOR UPDATE` 를 alias 없이 내면 PostgreSQL 은 문장의 모든 테이블을 잠그지만,
`FOR ... OF <alias>` 로 내면 루트만 잠근다. **어느 쪽인지는 실제 발행 SQL 을 봐야 한다** —
이 배치에서 두 번 시도했으나 `logback-spring.xml` 의 `<root level="INFO">` 가 `org.hibernate.SQL`
DEBUG 를 삼켜 확인에 실패했다.

그래서 **부모 잠금에 기대는 서술을 전부 뺐다.** 동시 `endChallenge`/`deleteChallenge` 와의
직렬화를 논하려면 발행 SQL 을 먼저 확인하고, 필요하면 **부모를 잠금 조회의 루트로 삼거나
별도 `FOR UPDATE`** 를 취해야 한다. 그건 이 티켓 범위 밖이다.

> 📌 **2026-08-11 정정 이력 (두 번 고쳤다).**
> ⑴ 초판: 「`FOR UPDATE` 락 범위 밖 읽기를 `JOIN FETCH` 가 막는다」 → **과장**이었다.
> ⑵ 1차 정정: 「PostgreSQL 이 `OF` 절 없는 `FOR UPDATE` 로 모든 테이블을 잠그므로 부모는 이미
> 잠겨 있다」 → **이것도 확인되지 않은 주장이었다.** Hibernate 가 alias 를 붙여 내면 성립하지
> 않는데, 발행 SQL 을 못 봤다.
> ⑶ 현재: **잠금 범위에 기대는 서술을 전부 뺐다.** 근거는 `repeatDays` 불변성 하나로 충분하고,
> 그건 잠금과 무관하게 성립한다.
>
> 근거 없는 「이 변경이 경합을 고쳤다」를 남기면 다음 사람이 **있지도 않은 레이스를 전제로**
> 코드를 짠다 — GROMO-1285 가 지우고 있는 것과 같은 종류의 거짓 서술이다. 구현
> (`bfix/GROMO-1270-…`)의 javadoc 도 같은 취지로 정정돼 있다.

**⚠️ 이 리포지토리 파일은 GROMO-1270(WS-1)의 소유다.** 이 문서는 진단만 적는다.

### 3-2. 비트 연산은 `RepeatSchedule`에 넣는다 — 그 클래스가 스스로 그렇게 선언한다

**결정**: `(maskA & maskB) == 0` 을 `GroupChallengeService` 안에 인라인으로 쓰지 않는다.
`RepeatSchedule` 에 `overlaps(int maskA, int maskB)` 같은 이름으로 넣고 서비스는 그걸 부른다.

**근거**: `back/src/main/java/com/oneorthree/phone/group/domain/RepeatSchedule.java:10,16` javadoc이
직접 선언한다.

```java
 * 요일 반복 스케줄(§A3 · LLD §3.4) — {@code repeat_days} 비트마스크의 <b>단일 소유자</b>.
```

```java
 * 전부 이 유틸을 거친다 — 경로마다 비트 연산을 새로 만들면 조용히 갈라진다.
```

"조용히 갈라진다"가 정확한 위험 서술이다 — 겹침 판정만 자체 비트 연산을 쓰면, 나중에
마스크 인코딩이 바뀌었을 때 회차 개설·참여·알림은 따라가고 **겹침 판정만 남는다.**

`RepeatSchedule`은 이미 `bit()` · `maskOf()` · `isValidMask()` · `activeOn()` · `next()` 를
들고 있다. 새 함수도 같은 자리다.

---

## 4. 낡은 주석 2건 — 함께 지운다

둘 다 `GroupChallengeWindowRepository.findActiveByGroupForUpdate` 의 javadoc
(`back/src/main/java/com/oneorthree/phone/group/repository/GroupChallengeWindowRepository.java:19-28`)에 있다.
**GROMO-1270이 이 메서드를 건드리므로 같은 PR에서 정리하는 게 맞다.**

| # | 줄 | 원문 | 왜 거짓인가 |
|---|---|---|---|
| 1 | `:22` | `활성 창형은 카테고리×타입당 1개(V20 부분 유니크)라 최대 2행이다.` | **GROMO-1422**(§9.1 S15)가 활성 챌린지 부분 유니크를 완화했다 — 하루형만 `(group_id, category)` 로 남고 **창형은 복수 허용**이다. 4개 상한 안에서 창형이 4행까지 나올 수 있다. 같은 사실을 `GroupChallengeService.java:436`이 이미 반영해 적고 있다: `하루형만 카테고리당 활성 1개(FR-3 · V36 부분 유니크) — 창형은 겹침 검사만 통과하면 복수 허용.` |
| 2 | `:24` | `<p>겹침 판정 자체는 KST 시각(time-of-day) 기준 + 자정 걸침 전개가 필요해 SQL 이 아니라 서비스…에서 한다.` | **GROMO-1406**(§9.1 S10 · §A6-1)이 자정 걸침을 **금지**로 되돌렸다. 전개는 필요 없다 — `GroupChallengeService.java:627-628`이 이미 그렇게 적고 있다: `자정 걸침이 금지(§A6-1)라 <b>단일 구간 비교</b>로 충분하다 (종전의 2구간 전개(daySegments)는 걸침 허용 시절의 잔재였다 — GROMO-1406 되돌리기).` |

**"서비스에서 한다"는 결론 자체는 여전히 옳다** — SQL로 옮기라는 얘기가 아니다.
틀린 건 **이유**(자정 걸침 전개)뿐이므로, 이유를 "요일 마스크 ∧ 시각 비교라 SQL보다
서비스가 낫다"로 갈아 끼우면 된다.

### 3-1과 함께 지울 것 하나 더

`GroupChallengeService.java:615-616`의 한계 문단은 GROMO-1270이 끝나면 **거짓이 된다.**

```java
 * <p>한계(후속 GROMO-1270): 요일 교집합(요일이 안 겹치면 시간대가 같아도 무방)과 15분 간격 규칙은
 * 아직 반영 전이다 — 그때까지는 요일 무관하게 시간대만으로 겹침을 판정한다(엄격한 쪽으로 보수적).
```

같은 javadoc의 `:613` `맞닿음(끝==시작)은 겹침이 아니다(종전 겹침 검사와 동일).` 도
**정확히 뒤집힌다** — 맞닿음은 간격 0분이라 이제 409다(경계값 표 E2).
지우지 않으면 다음 사람이 맞닿음을 허용으로 읽는다.

---

## 5. 이번 배치에서 손대지 않는 것

- **정책** — §A5는 변경 없다. [`policy.md`](./policy.md) 참조.
- **DB 스키마** — 요일 마스크(`repeat_days`)는 V34에 이미 있다. 새 마이그레이션 없음.
- **에러 코드** — `CHALLENGE_WINDOW_OVERLAP` 그대로. 새 코드 없음(앱이 문자열로 분기한다).
- **`refundedCount` · `BET_FOCUS_ONLY`** — [`policy.md` 「손대지 말 것」](./policy.md) 참조.
