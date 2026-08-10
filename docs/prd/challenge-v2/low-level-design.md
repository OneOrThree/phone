# 챌린지 상세 설계 — v2 델타 (GROMO-1270 창 겹침 판정)

> **문서 세트 v2 · 상위 정본(`docs/prd/challenge/low-level-design.md`)에 병합 대기(후속 티켓)**
> 여기 없는 설계는 전부 상위 정본이 정본이다. 세트 전체 설명은 [`README.md`](./README.md).
> 정책 근거는 [`policy.md`](./policy.md) — **정책은 변경 없다.**

---

## 1. 구현 계약 — `conflicts()`

**결정**: 아래 코드가 GROMO-1270의 **구현 계약**이다. 상위 정본
`docs/prd/challenge/low-level-design.md:1014-1036` §3.6에 이미 적혀 있고, 구현은 이걸 옮긴다.

### 정본 원문 (`docs/prd/challenge/low-level-design.md:1014-1036`, verbatim)

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

### 2-2-bis. ⚠️ 알려진 빈틈 — 자정 경계를 넘는 인접 (정책 안건, 미해결)

판정식은 **같은 날짜 안의 선형 구간**만 비교한다. 그래서 아래 조합이 통과한다.

| A (매일) | B (매일) | 같은 날 기준 간격 | 판정 | 실제 인접 |
|---|---|---|---|---|
| `23:50–23:59` | `00:00–00:10` | 23시간 40분 | **허용** | 월 A 종료 ↔ **화** B 시작 = **1분** |

**구현 결함이 아니라 §A5 자체가 이 경우를 안 덮는다.** 정본 §3.6이 그 단순화를 의도적으로
택했다 — "자정 걸침 금지가 이 함수를 절반으로 줄인다 … 지금은 **구간 하나 대 구간 하나**의
단순 비교이고, 요일 마스크가 어느 날 것인지 되물을 일도 없다". 요일 회전(`d±1`)을 넣으면
GROMO-1406이 걷어낸 2구간 전개가 다른 형태로 돌아온다.

**두 근거 중 하나는 실제로 안 깨진다.** 15분 근거는 "스크린타임 창이 15분 눈금이라 그보다
좁은 간격은 **눈금 하나가 두 창에 걸친다**"인데, 눈금은 `:00/:15/:30/:45`에 정렬되므로
A는 `23:45–00:00` 눈금 안, B는 `00:00–00:15` 눈금 안이다 — **공유하는 눈금이 없어 경계
측정이 섞이지 않는다.** 남는 건 중복 보상 근거인데, 이쪽도 성격이 갈린다: 연속 20분이지만
**서로 다른 두 날의 회차**라 한 회차가 두 번 보상받는 구조는 아니다.

**그래서 이 배치에서는 고치지 않는다.** 판정식만 바꾸면 정본 §A5·§3.6과 코드가 어긋난다.
§A5에 자정 경계 인접을 넣을지는 **정책 결정**이고, 넣는다면 `86400`초 이동 구간 + 요일
마스크 회전을 계약에 명시하고 그 대가(2구간 전개 복귀)를 함께 적어야 한다.
도달 가능성이 낮지는 않다 — 창 4개 상한 안에서 자정 양옆에 창을 두는 조합은 만들 수 있다.

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

### 3-1. `findActiveByGroupForUpdate`는 `JOIN`이지 `JOIN FETCH`가 아니다 (N+1 + 락 밖 읽기)

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

1. **N+1** — 활성 창형 수만큼 `SELECT group_challenges` 가 추가로 나간다.
2. **`FOR UPDATE` 락 범위 밖 읽기** — 배타 락은 `group_challenge_windows` 행에 걸렸는데
   요일 마스크는 락이 안 걸린 부모 행에서 별도 쿼리로 읽는다. 동시 생성·삭제와 직렬화하려고
   락을 잡은 목적(같은 javadoc이 선언한다)이 **판정에 실제로 쓰이는 값에는 적용되지 않는다.**

**해결(둘 중 하나)**:

- `JOIN` → **`JOIN FETCH`** 로 바꿔 부모를 같은 쿼리·같은 락으로 싣는다, 또는
- **`(repeatDays, windowStart, windowEnd)` 프로젝션**으로 필요한 3값만 뽑는다 — 엔티티가
  필요 없으므로 이쪽이 더 정직하다.

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
