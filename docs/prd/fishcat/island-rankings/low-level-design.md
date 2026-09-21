# 주간 랭킹 상세 설계

> **2026-09-21 개정(GROMO-1997 구현 반영).** 종전 문서는 ① 주민 랭킹 `GET /islands/{islandId}/rankings/members`
> 를 정상 계약으로 서술했고 ② 주를 「KST 월요일 + ISO week-year」로 잡았으며 ③ 불변 snapshot·전 사용자
> 역색인·공통 lifecycle 잠금을 요구했다. 셋 다 바뀌었다 — 근거는 각 절에 적었고 결정 표는
> [policy.md](policy.md) 가 정본이다.

## 1. 원본 요청·응답

### ~~GET `/islands/{islandId}/rankings/members`~~ — **폐지**

2026-09-16 결정 B23·B15. 기획 v1 98계약에 없고 화면 자체가 B15 로 폐지됐다. **BFF 화면에서만 빠지는 것이
아니라 엔드포인트 자체의 폐기**다. 기획 정본도 「전망대는… 우리 섬 내부 주민 랭킹은 제공하지 않는다」라고
적는다. 따라서 `eligibility`·`myRank`(주민)·최소 2명 조건·주민 공개 projection(`userId`·`name`·`catColor`)은
이 설계에서 **전부 사라진다**.

### GET `/rankings/islands`

원본 `/v1/rankings/islands`. 요청은 query 다(body 아님).

```json
{
  "week": "2026-09-06",
  "cursor": null
}
```

응답:

```json
{
  "data": {
    "items": [
      {
        "rank": 1,
        "islandId": "019f16a0-0000-7000-8000-000000000010",
        "name": "소다 섬",
        "averageFocusSeconds": 18000
      }
    ],
    "myRank": 4,
    "nextCursor": null,
    "asOf": "2026-09-11T09:10:00Z"
  }
}
```

원본 대비 추가는 둘이다 — 승인된 `asOf`, 그리고 `myRank`(RK-D10, 기획 확인 대기). `myRank` 는 목록을 상위
N 으로 자르는 대신 자기 섬 순위를 알려 주기 위한 것이라 RK-D07 과 한 쌍이다. 원본의 `week` 값
`"2026-W37"` 은 더 이상 쓰지 않는다(§2).

## 2. 채택 스키마·기간·인가

| API | query | data |
| --- | --- | --- |
| islands | `week` 필수, `limit` 선택(1~100, 기본 30) | `items[{rank,islandId,name,averageFocusSeconds}]`, `myRank` nullable, `nextCursor`(언제나 null), `asOf` |

`asOf` 는 집계를 고정한 UTC instant 다. `items`·`myRank`·분모·표시 점수가 모두 이 한 관측에서 나온다.

### 주 식별자

`week` 는 **주 시작일 `YYYY-MM-DD`** 이고 그 날짜는 **UTC 일요일**이어야 한다.

- 형식이 `YYYY-MM-DD` 가 아니면 400 `INVALID_PARAMETER`(field=week) — ISO `2026-W37` 도 여기서 걸린다.
- 형식은 맞는데 없는 날짜(2월 30일)면 422 `OUT_OF_RANGE`.
- 일요일이 아니거나 **아직 오지 않은 주**면 422 `OUT_OF_RANGE`. 달력 의미 판정은 Data 가 한다(서버 시계가 필요하다).

**ISO `YYYY-Www` 를 쓰지 않는 이유.** ISO 주차는 «월요일 시작»이 정의의 일부다. 정책이 일요일로 바뀌었는데
표기를 그대로 두면 `2026-W37` 이 ISO 가 말하는 7일과 다른 7일을 가리킨다 — 앱·서버·로그·지표가 같은 문자열로
서로 다른 주를 뜻하게 되는, 가장 조용한 종류의 버그다. 주 시작일은 자기 자신이 경계를 말하므로 해석 규칙이
없고, 「53주차가 없는 해」 같은 달력 예외도 사라진다. 창은 `[weekStart 00:00Z, weekStart+7d 00:00Z)` 반열림이다.

### 인가

Data 가 요청자의 `user_island_contexts.current_island_id` 를 한 번 확정해 검사한다 — 앱 헤더의 섬을 권한으로
믿지 않는다.

1. 요청자 계정이 활성이 아니면 404 `USER_NOT_FOUND`.
2. 현재 섬이 없으면 403(`MEMBER_ONLY` → 공개 `FORBIDDEN`) — 「어느 섬의 주민으로서」 보는 화면이다.
3. 현재 섬이 소프트 삭제·종료됐으면 404 `GROUP_NOT_FOUND`.
4. 그 섬의 활성 주민이 아니면 403 `MEMBER_ONLY` → 공개 `FORBIDDEN`.
5. 그 섬의 **전망대가 완공되지 않았으면** 403 `OBSERVATORY_LOCKED` → 공개 `FACILITY_LOCKED`.

이 현재 섬이 `myRank` 의 대상이다. 1인 섬이 랭킹에 참가하지 않더라도 섬 발견 endpoint 의 접근 규칙은 바뀌지
않는다(RK-P03).

## 3. 주간 점수·분모·순위

```text
window   = [UTC 일요일 00:00Z, 다음 일요일 00:00Z)
분자(i)  = Σ  overlap(ACTIVE 구간, window)          -- lifecycle=COMPLETED, island_id=i 인 세션만
분모(i)  = 끝난 주면 island_weekly_member_counts(week, i).member_count
           진행 중인 주면 지금 활성 주민 수
평균(i)  = floor(분자 / 분모)                       -- 분모가 없거나 0 이면 «참가 아님»
순위     = RANK() over (평균 DESC)                  -- 동점은 공동 순위, 다음은 건너뜀
표시 순서 = 평균 DESC, islandId ASC                  -- 보조 키이지 순위 기준이 아니다
```

**분자.** 세 가지가 정책이다.
- `lifecycle = COMPLETED` — **끝난 집중만** 반영한다(RK-D03). 진행 중 세션은 정렬·표시·`myRank` 어디에도 없다.
  종전 문서가 열어 두었던 「진행분을 `asOf` 로 닫아 합산」 분기는 채택되지 않았다.
- ACTIVE 구간만 — 휴식은 더하지 않는다(RK-P04). 기존 `now - startedAt` 식은 휴식을 가산하므로 쓰지 않는다.
- `island_id` 는 **세션이 시작할 때 고정한 섬**이다(RK-D05 = 2026-09-19 결정 RC-D01). 같은 주민이 다른 섬에서
  한 집중은 이 섬 분자가 아니다. 세션 `island_id` 가 없는 legacy 기록을 현재 멤버십으로 추정해 백필하지 않는다.

정밀도는 `FocusIntervalMath` 와 **같은 규율**이다 — 구간마다 초로 내리지 않고 창과의 교집합을 그대로 합친 뒤
**마지막에 한 번만** 내린다. 구간마다 잘랐다면 휴식이 잦은 세션에서 초가 조금씩 사라진다. 섬을 가로지르는
집계라 세션을 메모리로 올리지 않고 `GROUP BY island_id` 한 문장으로 접는다(회관 기록이 한 섬을 엔티티로 올려
Java 에서 더하는 것과 다른 점이다).

**분모.** 기획 정본의 「그 섬 전체 주민 수」이고, 모수는 `GroupMemberRepository.countByGroupIdIn` 과 같다
(활성 멤버십 `is_left=false` + 미탈퇴 계정 `is_deleted=false`) — 주민 목록·정원 판정과 같은 기준이라
「목록 N명 · 분모 N+1명」이 생기지 않는다. **주가 끝난 시점으로 동결**한다(RK-D01, migration V85) —
`group_members` 에 `left_at` 이 없어 사후 복원이 불가능하고, 동결하지 않으면 주민을 내보내는 것만으로 지난 주
평균이 오르기 때문이다. 끝난 주에 동결 행이 없으면 그 섬은 **빠진다**(RK-D01-결손) — 「지금 인원으로」 대체하면
그 조작이 그대로 살아난다.

**평균과 순위.** 평균을 **먼저 정수로 내린 뒤 그 값으로 줄 세운다** — 표시값과 정렬 키가 같아야 「화면에는 같은
숫자인데 순위가 다른」 줄이 생기지 않는다. 주민마다 분으로 내려 평균내지 않는다. 동점은 공동 순위이고 다음
순위를 건너뛴다(RK-D02: 1,1,3). UUID 오름차순은 같은 점수 안의 표시 순서만 고정한다. `myRank` 는 페이지 위치가
아니라 **전체 모집단**에서의 순위이고, 참가하지 않는 섬은 `null` 이다 — 없다는 이유로 0위를 만들지 않는다.

**참가 모집단**은 그 주에 그 섬 귀속 완료 집중이 있었던 섬이다(RK-D09). 집중이 0인 섬을 0점으로 줄 세우지
않고, 그런 섬의 `myRank` 는 `null` 이다. 모수가 집계 결과라 이어지는 분모·이름 조회도 자연히 유한하다.

## 4. 페이지와 snapshot — 만들지 않는다

종전 §4 는 불변 snapshot 저장소, `snapshotId → 사용자` / `사용자 → snapshotId` 역색인, 중앙 withdraw 와의 공통
lifecycle 잠금 `public-statistics-snapshot-lifecycle`, 15분 cursor TTL, `CURSOR_EXPIRED` 를 요구했다.
**전부 만들지 않는다**(RK-D07·RK-D08).

그 장치는 모두 **「표에 복사된 타인의 개인정보」**를 지키려는 것이었다. 섬 간 랭킹 응답에는 섬 이름과 평균
초밖에 없다 — 사용자 이름도, catColor 도, 개인 점수도 없다. 2026-09-19 결정 RC-P12-적용이 회관 기록에서 같은
판단을 내렸다: 「타인 개인정보 스냅샷을 만들지 않는 설계로 lifecycle 잠금 gate 를 해소… **복사본이 없으면
필요 없다**」. 주민 랭킹이 폐지되면서 이 모듈에서 타인 PII 가 나올 자리가 사라졌다.

페이지 자체도 없앴다. 움직이는 집계에 keyset 을 붙이면 페이지 사이의 점수 변화로 행이 빠지거나 겹치는데,
**상위 `limit` 개만 한 번에 주고 그 아래는 `myRank` 로 알려 주면 그 문제가 성립하지 않는다**. 따라서
`nextCursor` 는 언제나 `null` 이고, 들어온 `cursor` 는 발급한 적이 없으므로 400 `INVALID_CURSOR` 다
(회관 기록 scope=island 와 같은 처리). 분자·분모는 한 REPEATABLE READ 트랜잭션에서 함께 읽어
`items`·`myRank`·분모가 같은 관측에서 나온다(RK-P06).

공개 응답은 `Cache-Control: no-store` 다(공개 경로 공통). Data 밖에 payload 를 복제·캐시하지 않는다.

## 5. 저장·부수효과·계약 경계

새 표는 하나다 — **`island_weekly_member_counts`(migration V85)**: `(week_start, island_id)` PK,
`member_count > 0` CHECK, `EXTRACT(ISODOW FROM week_start) = 7` CHECK(키가 정말 일요일인지 DB 가 지킨다),
`island_id → groups ON DELETE CASCADE`. 쓰기는 주 마감 크론 한 곳뿐이다:

```
@Scheduled(cron = "0 0 0 * * SUN", zone = "UTC")  +  @SchedulerLock("island-weekly-ranking-freeze")
INSERT INTO island_weekly_member_counts … SELECT … GROUP BY gm.group_id ON CONFLICT DO NOTHING
```

<<<<<<< HEAD
크론이 도는 시각은 이미 «새» 주이므로 대상은 직전 주다. `ON CONFLICT DO NOTHING` 이 멱등 가드다 — 두 번 돌아도
그 주의 분모는 **처음 적힌 값** 그대로다.

**기준 시각은 실행 순간이 아니라 주 종료 경계다**(RK-D01-기준시각). 가입은 `created_at < 경계` 로 걸러 경계 이후
가입자가 지난 주 분모에 섞이지 않게 한다(`created_at` 이 null 인 legacy 행은 «경계보다 오래된 행»으로 보고 포함한다 —
DB 가 NOT NULL 이 아니라 빼면 옛 주민이 통째로 사라진다).

**이탈 방향은 쿼리로 닫을 수 없다.** `group_members` 에는 이탈 시각이 없다 — `left_at` 컬럼이 없고, `updated_at` 은
알림 토글 같은 아무 변경에도 갱신되므로 이탈의 증거가 아니며, `created_at` 은 `rejoin()` 이 갱신하지 않아 «최초»
가입 시각이다. 그래서 「경계 시점에 활성이었는가」를 사후에 판정할 근거가 DB 에 존재하지 않는다. 대신 **실행 유예**
(`ranking.freeze.grace`, 기본 1시간)를 넘긴 실행은 **아무것도 쓰지 않는다** — 첫 값이 영구 고착되므로, 늦게 돈
배치가 「하루치 이탈이 반영된 인원」을 그 주의 정답으로 굳히는 쪽이 더 나쁘다. 쓰지 않으면 그 주는 분모가 없어
랭킹에서 빠지고(RK-D01-결손) 경고 로그가 남는다. 남는 창(경계 ~ 실제 실행 사이의 이탈)은 RK-D12 로 추적하며,
닫으려면 소속 도메인에 이탈 시각 컬럼이 필요하다.
=======
크론이 도는 시각은 이미 «새» 주이므로 대상은 직전 주다. `ON CONFLICT DO NOTHING` 이 멱등 가드다 — 두 번 돌든,
늦게 돌든, 락이 새든 그 주의 분모는 **처음 적힌 값** 그대로다. 덮어쓰기였다면 하루 늦게 돈 배치가 하루치
이탈을 반영해 동결의 의미가 사라진다.
>>>>>>> origin/bfeat/GROMO-1997-island-weekly-ranking

분자는 **복제하지 않는다**. 집중 정본(`focus_session_details`·`focus_session_intervals`)이 그대로 남아 있어
언제든 같은 창으로 다시 합칠 수 있고, 복제하면 정본과 어긋날 자리를 만든다. 그 대가로 «주 경계를 걸친 세션이
늦게 끝나면 지난 주 합이 늘어나는» 창이 남는다 — cutoff 여부는 RK-D04 미결이다.

랭킹 GET 은 읽기 응답 외의 경제 효과가 0이다. 지갑·보상 원장을 호출하지 않고, 기존 리그 정산 함수도 부르지
않으며, 새 realtime 사건을 만들지 않는다.

**표면.** 내부 `GET /internal/users/{userId}/island-rankings` — 경로 섬이 없는 «전체 섬» 순위라 주체 축이다
(B26, 1759 의 `island-search`·`island-discovery` 와 같은 자리). 공개 `GET /rankings/islands` 는
`PublicApiRoutes.ROOTS` 의 `/rankings/**` 에 이미 걸려 봉투와 `no-store` 가 붙는다. Business 는 **모양**만 본다 —
허용 query 키, 날짜 형식과 실재, limit 범위. 전망대·주민·주차 의미 판정은 Data 몫이다.

## 6. 오류와 검증

실패는 `{error:{code,message,field,retryable},requestId}`.

| HTTP/code | 의미 | retryable |
| --- | --- | --- |
| 400 `INVALID_PARAMETER` | week 형식·허용 밖 query 키·중복 query | false |
| 400 `INVALID_CURSOR` | 이 계약에는 페이지가 없다 — 들어온 커서는 위조다 | false |
| 401 `UNAUTHORIZED` | 사용자 인증 실패 | false |
| 403 `FORBIDDEN` | 현재 섬이 없거나 그 섬의 활성 주민이 아님 | false |
| 403 `FACILITY_LOCKED` | 전망대 미완공(Data `OBSERVATORY_LOCKED`) | false |
| 404 `USER_NOT_FOUND` / `GROUP_NOT_FOUND` | 요청자 비활성 / 현재 섬 부재·종료 | false |
| 422 `OUT_OF_RANGE` | 없는 날짜·일요일 아님·아직 오지 않은 주(field=week), limit 범위(field=limit) | false |
| 429 / 503 / 504 | 공통 일시 제한·집계 실패 | true |
| 502 `UPSTREAM_CONTRACT_ERROR` | 상류가 다른 주를 답하거나 표에 없는 (상태, 코드) | false |

표에 있는 **(상태, 코드) 쌍이 정확히 같을 때만** 공개 오류로 옮기고 나머지는 502 다 — Data 가 같은 코드의
상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.

### 검증 (구현된 회귀)

`IslandRankingsIntegrationTest`(실 Flyway·Testcontainers) · `RankingWeekTest` · `InternalRankingsAllowlistTest` ·
business `IslandRankingsContractTest`:

- 주 경계 — 일요일 자정 반열림, 경계를 걸친 세션은 주 «안»의 몫만, 월요일 날짜·미래 주는 422,
  ISO 주차가 이 경계와 어긋난다는 사실 자체를 못박는다.
- 분자 — 휴식 제외, 다른 섬 귀속 제외, 진행 중 세션 제외.
- **분모 동결 — 주가 끝난 뒤 주민을 강퇴해도 지난 주 평균이 오르지 않는다.** 동결의 존재 이유라 반드시 있다.
- 동결 결손 — 끝난 주에 행이 없는 섬은 빠지고 `myRank` 는 `null`.
- 진행 중인 주는 지금 인원으로 나눈다(동결 행 없음).
- 동결 멱등 — 재실행이 이미 적힌 값을 덮지 않는다.
- 동점 공동 순위 1,1,3 / 목록이 잘려도 `myRank` 는 전체 모집단 기준 / 집중 0인 섬은 참가 아님.
- 게이트 — 전망대 미완공 403, 현재 섬 없음 403, 종료 섬 404.
- 공개 계약 — query 모양, `nextCursor` 부재, 들어온 커서 400, 상류 실패 표, 주 불일치 502, 내부 허용목록.

로그는 requestId·주차·소요·집계 섬 수 같은 유한 label 로 남기고 사용자·전체 결과를 남기지 않는다.
