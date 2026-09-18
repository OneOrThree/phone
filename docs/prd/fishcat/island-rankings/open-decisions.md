# 전망대 랭킹 미결 결정표 — GROMO-1777

[정책](policy.md) RK-D01~D06 의 **선택지·결과·레포 선례·추천**을 한 장에 모은다.
정책 정본은 `policy.md` 이고 이 문서는 그 미결을 **결정 가능한 형태로 펼친 것**이다. 충돌하면 `policy.md` 가 우선한다.
여기의 추천은 승인이 아니다 — 승인 전에 어떤 기본값도 코드에 넣지 않는다.

---

## 0. 먼저 — 이 결정들이 다 나도 지금은 구현할 수 없다

**RK-D01~D06 을 오늘 전부 승인해도 두 엔드포인트는 영원히 `items: []` 를 반환한다.** 정책이 미결이라서가 아니라
**집계할 행이 0개**여서다. 근거 4건은 전부 기준 코드에 있다.

| # | 사실 | 근거 (파일:줄) |
| --- | --- | --- |
| 1 | 집중 세션 시작 게이트가 **하드 `false`** 라 세션이 하나도 시작되지 않는다 | `server/data-api/src/main/java/com/oneorthree/phone/focus/support/FocusSessionStartGate.java:65-67` — `public static boolean isOpen() { return false; }`. 호출부 `internal/service/FocusSessionLifecycleService.java:139` 가 `false` 면 `FocusErrorCode.SESSION_START_UNAVAILABLE`(503, `focus/exception/FocusErrorCode.java:70`)로 거절한다 |
| 2 | 섬 축을 가진 **유일한** 테이블 `focus_session_details` 에 행이 0개다 | `db/migration/V58__focus_session_lifecycle.sql:10` — `island_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT`. 컬럼은 있으나 ①때문에 INSERT 되는 경로가 없다 |
| 3 | 기존 집계 테이블 `daily_focus_stats` 에는 **섬 축이 없다** | 엔티티 `focus/repository/domain/DailyFocusStat.java:34-85` — `user_id`·`date`·`total_focus_seconds`·`session_count`·`total_distraction_seconds`·`is_focus_time_goal_achieved` 뿐, `island_id` 없음. 유니크는 `(user_id, date)`(같은 파일 35-38) |
| 4 | `/rankings/islands` 가 요구하는 현재 섬 context 가 **전부 NULL** 이고, 읽기 전용으로 **조회할 방법이 없다** | `db/migration/V57__user_island_context.sql:26` — `current_island_id uuid REFERENCES groups (id) ON DELETE SET NULL`, 같은 파일 1-41 줄에 `UPDATE`(백필) 문이 **없다**. 리포지토리 `group/repository/UserIslandContextRepository.java:25-36` 에는 메서드가 `findByIdForUpdate` **하나뿐**이고 33줄이 `@Lock(LockModeType.PESSIMISTIC_WRITE)` 라, 읽기 전용 랭킹 조회가 매 요청 쓰기 잠금을 잡게 된다 |

**게이트를 여는 티켓**

| 게이트 | 티켓 | 상태(2026-09-18) |
| --- | --- | --- |
| ①② 시작 게이트 → `focus_session_details` 에 행이 생김 | **GROMO-1924** 「집중 세션 시작 게이트를 여는 선행 조건 9건을 해소하고 게이트를 연다」 | 해야 할 일 |
| ④ 섬 컨텍스트 배선 → `current_island_id` 가 채워지고 비잠금 조회가 생김 | **GROMO-1759** 「섬 생성·조회·탐색·현재 섬 이동 API 구현 — 6종」 | 진행 중(리뷰 대기)<br>(정밀도: `JpaRepository` 상속 `findById(UUID)` 는 비잠금이다 — «커스텀» 비잠금 조회가 없다는 뜻. 진짜 막는 것은 `current_island_id` 가 전부 NULL 이라는 점) |

③ 은 티켓이 아니라 **RK-D05 의 결과**다 — 섬 귀속을 고르면 `focus_session_details`(①②) 를 쓰고,
개인 전체를 고르면 `daily_focus_stats` 를 쓴다. §2.4 를 보라.

> 그래서 1777 의 순서는 **정책 승인 → 1924·1759 완료 → 구현**이다. 정책 승인만으로 착수 가능해지지 않는다.
> 반대로 **정책이 미결이면 1924·1759 가 끝나도 착수할 수 없다.** 두 축은 독립이고 둘 다 필요하다.

---

## 1. 한 장 요약

| ID | 무엇을 정하나 | 추천 | 새 스키마 비용 | 늦으면 막히는 것 |
| --- | --- | --- | --- | --- |
| RK-D01 | 평균 분모·cohort·최소 인원 판정 시점 | 주 마감 시 **인원 1정수 동결**(C′) | V59 1테이블(섬×주×인원) | 두 엔드포인트 전부 |
| RK-D02 | 동점 순위 함수 | **공동순위 1,1,3**(`RANK()`) | 0 | 순위 함수·동점 테스트 |
| RK-D03 | 현재 주 진행분 포함 여부·갱신 주기 | **완료분만** | 0 | snapshot 생성 쿼리 (가장 늦게 정해도 되는 결정) |
| RK-D05 | 귀속 — 개인 전체 vs 섬 귀속 | **섬 귀속**(`session.islandId`) | 0 (V58 에 이미 있음) | D01 과 한 덩어리. RC-D01 과 같은 답이어야 함 |
| RK-D06 | 반올림·0분모·eligibility enum·썸네일 | 정렬=정수곱 비교 / 표시=내림 정수초, 0분모=제외, enum 2값, 썸네일 없음 | 0 | 공개 DTO 확정 → 앱 프레임 58 |

RK-D04(지난 주 마감 시각·지연 반영 수용 창)는 이 표의 대상이 아니다 — 작업 지시 범위 밖이라 펼치지 않았다.
`policy.md:22` 의 기술 그대로 미결이며, §2.3 의 D03 추천(완료분만)을 고르면 D04 의 「진행분을 언제 얼리나」 갈래가 사라져
**cutoff 하나만 남는다**는 관계만 적어 둔다.

---

## 2. 결정별 상세

### 2.1 RK-D01 — 평균 분모·cohort·최소 인원 판정 시점

**문서 상태**: `policy.md:19` (추천 = 「주차별 cohort·가입 이력 고정」, 승인 전 조건 = 「실제 cohort/분모/eligibility 계산·공개 출시 차단」).
파급은 `policy.md:6`(RK-P02 최소 2명), `low-level-design.md:101`(`D = approvedDenominator(...)`), `:110`(myRank=null 대상), `:112`(중도 가입·강퇴·재가입 복원 불가).

| 선택지 | 결과 — 가능해지는 것 / 막히는 것 | 필요한 스키마·인덱스 |
| --- | --- | --- |
| **A. 조회 시점 현재 주민 전원** | 지금 스키마로 즉시 계산됨. 대신 **강퇴/탈퇴가 지난 주 점수를 사후에 바꾼다** — 주민을 내보내면 분모가 줄어 평균이 올라간다. 같은 주를 내일 다시 조회하면 다른 값이 나오므로 `policy.md:10`(RK-P06 같은 immutable snapshot)과 정면 충돌 | 0 |
| **B. 그 주 기여가 있는 주민만(활동 주민)** | 0초 주민이 평균을 깎지 않음. 대신 **분모가 점수에 종속**돼 「안 하는 주민을 빼면 유리」가 그대로 남고, 1인만 활동한 섬이 평균 1위가 된다 | 0 |
| **C. 주차 cohort + 재적 인일(person-days) 분모** | 중도 가입·탈퇴가 부분 주로 비례 반영돼 가장 공정하고 조작 내성이 최고. 대신 **가입/이탈 구간 이력 테이블이 새로 필요**하고, 개인정보 파기(LLD §4 역색인)가 그 테이블에도 걸린다 | V59 신규 — 멤버십 구간(`user_id, island_id, from, to`) + `(island_id, from, to)` 인덱스 |
| **C′. 주 마감 시점 인원수 1정수 동결** | C 의 핵심 효과(사후 조작 차단·재조회 안정)를 **정수 한 칸**으로 얻는다. 중도 가입자의 부분 주 비례만 포기 | V59 신규 — `(island_id, week)` PK + `member_count` 한 행 |

**레포 선례**

- `focus/repository/DailyFocusStatRepository.java:165` — 기존 리그 평균이 정확히 선택지 B다. 주석이 스스로 「분모는 모수 전체가 아니라 그 기간에 행이 있는 유저 수」라고 적는다. `low-level-design.md:206` 이 이 방식을 **새 주차 cohort 로 재사용하지 말라**고 명시한다.
- `group/repository/domain/GroupMember.java:57-61` — `@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"user_id","group_id"}))`. **유저×섬당 행이 영원히 하나**다. `:103-112` 의 `is_left`·`left_reason` 는 현재 상태 플래그일 뿐 `left_at` 타임스탬프가 없고, `:173` 의 `rejoin()` 이 새 이력 행을 넣지 않고 **같은 행을 되살린다**. 마이그레이션 원본은 `V1__baseline.sql:225-234` — `joined_at` 은 있으나 재가입 때 덮인다.
  → **「W주에 누가 주민이었나」를 현재 스키마로 복원할 수 없다**는 `low-level-design.md:112` 의 서술은 코드와 일치한다(확인함).

**추천: C′ (주 마감 시 인원 1정수 동결)**

근거 — A 는 RK-P06 불변성 계약을 깨고(같은 주가 조회할 때마다 달라짐), B 는 `low-level-design.md:206` 이 명시적으로 금지했다.
C 와 C′ 는 둘 다 사후 조작을 막지만, C′ 는 **섬×주당 정수 한 칸**이고 C 는 구간 이력 테이블 + 그 테이블에 대한 PII 파기 배선까지 딸려 온다.
중도 가입자 부분 주 비례가 제품 요구로 확정되기 전에는 C 의 추가 비용이 사는 게 없다. 나중에 C 로 올릴 때
동결 정수는 구간 이력에서 파생되는 값이라 **계약(JSON)은 그대로**고 policy revision 만 올리면 된다.
최소 2명 판정도 같은 동결값으로 하면 「지금 1명이라 비적격인데 지난 주는 3명이었다」가 모순 없이 표현된다.
`policy.md:19` 의 「현재 원본의 2명 숫자는 유지」는 그대로 둔다.

**늦어지면 못 나가는 것**: 두 엔드포인트 전부. `averageFocusSeconds` 의 분모와 `eligibility`/`myRank=null` 대상이 전부 여기서 나온다.
V59 번호를 잡는 결정이라 **가장 먼저 답해야 한다** — 이것만 스키마를 바꾼다.

---

### 2.2 RK-D02 — 동점 순위

**문서 상태**: `policy.md:20` (추천 = 공동순위 1,1,3 「**추천하되 미채택**」). `low-level-design.md:110` 이 「UUID ASC 는 안정 정렬 보조키일 뿐 공동순위 정책을 대신하지 않는다」고 못박는다.

| 선택지 | 결과 |
| --- | --- |
| **A. 공동순위 + 건너뛰기 (1,1,3)** | SQL `RANK()` 한 줄. 「나보다 앞선 사람 수 + 1」이라 myRank 를 페이지와 무관하게 전체 모집단에서 정의하기 쉽다 |
| **B. 조밀 순위 (1,1,2)** | `DENSE_RANK()`. 동점이 많으면 순위 숫자가 인원보다 훨씬 작아져 「2위인데 내 앞에 5명」이 생긴다 |
| **C. 별도 순번 (1,2) — 보조키로 가름** | 같은 점수인데 누가 1위인지 UUID 가 정한다. `low-level-design.md:110` 이 이미 배제한 방향 |

셋 다 **스키마·인덱스 추가 0**이다. 정렬 안정화용 UUID ASC 보조키는 A·B 와 공존한다(페이지 경계용, 순위 산정용이 아님).

**레포 선례**

- `league/service/LeagueService.java:155` — 기존 리그가 `i+1` 로 순번을 매긴다. 곧 선택지 C 이고, `low-level-design.md:205` 가 「i+1 은 공동순위 정책이 아님」이라고 **선례를 선례로 쓰지 말라**고 적어 둔 자리다.
- `league/repository/domain/LeagueRankSnapshot.java:21-26` — 유니크는 `uq_league_rank_snapshots_user_day (user_id, created_at)` 이고 필드는 `id·userId·rank·createdAt` 뿐(`:36-48`). **사용자×날짜당 rank 한 개를 덮어쓰는 저장소**라 주간 랭킹의 불변 페이지 정본으로 재사용할 수 없다(`low-level-design.md:118` 의 서술과 일치).

**추천: A (1,1,3)**

근거 — `policy.md:20` 이 이미 추천한 값이고, 비용이 0이며(`RANK()`), 「몇 명이 나보다 앞서는가」가 사용자 직관과 일치한다.
B 는 표시 순위와 실제 등수가 갈려 myRank 설명이 어려워지고, C 는 LLD 가 배제했다.

**늦어지면 못 나가는 것**: 순위 부여 함수 자체와 동점 golden fixture. 1777 완료 조건의 「집계 규칙의 각 분기에 테스트가 있다」를
**쓸 수조차 없다** — 기대값 표가 없다. 스키마를 안 바꾸므로 D01 보다 늦게 답해도 되지만, 테스트를 먼저 쓰려면 이게 먼저다.

---

### 2.3 RK-D03 — 현재 주 진행분 포함 여부·갱신 주기

**문서 상태**: `policy.md:21`, `policy.md:8`(RK-P04 — 휴식은 더하지 않음, 진행분 포함 여부 자체는 D03), `low-level-design.md:108`, `:127`.

| 선택지 | 결과 |
| --- | --- |
| **A. 완료분만** | 집계 입력이 완료된 세션/일 집계 행뿐이라 이중 합 위험이 0. 대신 지금 집중 중인 시간이 순위에 안 보인다(세션 종료 시 반영). snapshot 갱신 주기를 제품이 따로 정할 필요가 없고 cursor TTL 15분이 그대로 수명이 된다 |
| **B. 진행 ACTIVE 포함** | 집중 중에도 순위가 오른다. 대신 ① 열린 구간을 `asOf` 로 닫아 합산해야 하고(`low-level-design.md:108`), ② finish 가 일 집계로 넘어가는 순간 **완료분+진행분 이중 합**이 0이어야 한다는 새 불변식이 생기며, ③ 같은 주를 15분 뒤 조회하면 순위가 바뀐다 |

둘 다 **스키마·인덱스 추가 0**이다.

**레포 선례**

- `low-level-design.md:204` 가 인용한 `league/repository/LeagueRankingQueryRepository.java:124/146/170` — 기존 리그의 live 계산은 `now - startedAt` 이라 **휴식 시간이 그대로 가산**된다. RK-P04(휴식 제외)와 어긋나므로 B 를 고르면 이 쿼리를 재사용할 수 없고 PR743 의 구간 기반 계산을 새로 써야 한다.
- 같은 선례가 top 은 live, 페이지는 settled 로 **섞어 쓴다**. `low-level-design.md:108` 이 이 혼용을 금지한다.

**추천: A (완료분만)**

근거 — B 가 사는 것은 「최대 한 세션 길이만큼 빠른 반영」뿐인데, 여는 결함 경로는 이중 합과 휴식 가산 **둘 다 이미 레포에서 한 번씩 난 종류**다.
주간 랭킹은 실시간 지표가 아니다(실시간 집중 현황은 `focusMembers` 조각이 따로 담당한다).
A→B 전환은 공개 JSON 을 바꾸지 않고 policy revision 만 올리면 되므로 **되돌리기 가장 싼 결정**이다.

**늦어지면 못 나가는 것**: snapshot 생성 쿼리. 다만 스키마를 안 바꾸고 계약도 안 바꾸므로 **다섯 중 가장 늦게 답해도 되는 결정**이다.

---

### 2.4 RK-D05 — 귀속: 개인 전체 vs 섬 귀속

**문서 상태**: `policy.md:23` (「회관 RC-D01 과 같은 사용자 질문. session.islandId 고정 기여 사용 추천, **답변 대기**」), `low-level-design.md:95`, `:112`.
같은 질문의 회관 쪽 기록은 `../island-records/policy.md:35` (RC-D01, 「부모가 사용자에게 질문했고 답변 대기」).

| 선택지 | 결과 |
| --- | --- |
| **A. 섬 귀속 — `session.islandId` 고정** | 섬을 옮겨도 과거 기여가 따라가지 않아 「그 섬에서 쌓은 시간」이라는 의미가 유지된다. 입력은 `focus_session_details`(`V58:10` 의 `island_id`) — **그런데 §0 ①② 때문에 행이 0개**다. legacy 세션은 islandId 가 없어 집계 밖(`low-level-design.md:95` 가 추측 백필을 금지) |
| **B. 현 주민의 개인 전체 합** | `daily_focus_stats` 만으로 계산되므로 **1924 없이 지금 당장 숫자가 나오는 유일한 선택지**. 대신 섬을 옮기면 개인 누적이 통째로 새 섬으로 이동해 **지난 주 섬 순위가 영입만으로 바뀐다**. RC-D01 추천(「이동 전 기록을 새 섬에 복사하지 않음」)과 정면으로 어긋나 회관과 랭킹이 서로 다른 귀속 규칙을 갖게 된다 |

> **이 결정이 「지금 구현 가능한가」를 직접 가르는 유일한 결정이다.** B 를 고르면 §0 의 ①②가 사라지고 ④만 남는다.
> 그 대가가 회관/랭킹 귀속 규칙 분기다.

**레포 선례**

- `db/migration/V58__focus_session_lifecycle.sql:10` — `island_id uuid NOT NULL`. 세션 단위 고정 귀속을 **이미 스키마가 전제**하고 있다(A 를 위한 컬럼이 선반영된 상태).
- `focus/repository/domain/DailyFocusStat.java:34-85` — 섬 축 없음, 유니크 `(user_id, date)`. B 는 이 표를 그대로 쓰고 현재 주민 목록과 JOIN 한다.
- `low-level-design.md:206` 이 인용한 `DailyFocusStatRepository.java:220` — `sumTotalFocusSecondsByUserIdIn` 은 **기간을 자르지 않는 전체 누적**이라 주간 랭킹에 그대로 쓰면 안 된다(주 범위 버전이 따로 필요).

**추천: A (섬 귀속)**

근거 — V58 이 이미 `island_id NOT NULL` 로 세션 귀속을 고정했고, RC-D01 추천과 같은 방향이라 회관/랭킹이 한 규칙으로 간다.
B 는 「지금 숫자가 나온다」가 유일한 장점인데, 그 숫자는 **영입으로 과거 순위가 바뀌는 숫자**라 출시 후에 되돌리면 사용자가 본 지난 주 순위가 재작성된다.
A 를 고르는 것은 **1924 가 열릴 때까지 랭킹이 비어 있음을 명시적으로 수용하는 것**이며, 이 문서 §0 이 그 수용의 근거다.
RC-D01 과 **한 번에 같은 답**으로 처리해야 한다 — 따로 답하면 두 도메인이 갈린다.

**늦어지면 못 나가는 것**: D01 의 cohort 저장 설계가 여기에 얹혀 있어 **D01 도 같이 멈춘다**(분모의 모수가 「섬 기여자」인지 「현 주민」인지가 안 정해짐).
`low-level-design.md:209` 의 구현 순서 1단계가 바로 이 질문이다.

---

### 2.5 RK-D06 — 반올림·0분모·eligibility enum·썸네일

**문서 상태**: `policy.md:24`, `policy.md:26`(eligibility enum 미승인·`FACILITY_LOCKED` 확정), `policy.md:28`(0분모), `low-level-design.md:85`(반올림), `:91`(썸네일).
네 갈래가 한 ID 에 묶여 있어 **따로 답할 수 있다** — 하나가 막혀 나머지가 멈추지 않게 쪼개 둔다.

| 갈래 | 선택지 | 추천·근거 |
| --- | --- | --- |
| **(a) 평균 반올림** | ① 내림 정수초 ② 반올림 정수초 ③ 소수 1자리 | **정렬은 정수곱 비교, 표시는 내림 정수초.** 두 섬 비교를 `N1*D2` 와 `N2*D1` 의 정수곱으로 하면 부동소수·반올림이 순위에 개입하지 않아 `low-level-design.md:106` 의 「내부 정렬 점수와 표시값이 다른 순위를 만들지 않는다」를 구조적으로 만족한다. 표시 정수초는 원본 예시 `18000`(`low-level-design.md:66`)과 타입이 같아 JSON 스키마가 안 바뀐다. **단** `low-level-design.md:85` 가 「원본 18000 만으로 내림 정수 정책을 확정하지 말라」고 했으므로 이건 승인이 필요한 추천이다 |
| **(b) 0분모** | ① 목록에서 제외 ② `averageFocusSeconds: 0` 으로 참가 | **① 제외.** `policy.md:28` 이 이미 「평균 분모가 0이면 숫자 0을 임의 순위 점수로 만들지 않는다」로 ②를 금지했다. 결정으로 남은 건 「제외한다」를 명문화하는 것뿐 |
| **(c) eligibility enum** | ① `eligible` + `insufficient_members` 2값 ② 시설·소속 사유까지 enum 확장 | **① 2값.** ②를 고르면 시설 미해금이 **200 의 enum 과 403 두 곳**에 생긴다 — 시설 미해금은 `403 FACILITY_LOCKED` 로 확정이다(`../api-platform/policy.md:52`, `low-level-design.md:89`·`:191`). 화면 조각의 `availability` 값(`facility_locked`·`host_only`·`none`, `../bff-screens/policy.md` B26)과는 **다른 축**이라 이름을 빌려오지 않는다 |
| **(d) 섬 썸네일 DTO** | ① 넣지 않음 ② 공개 썸네일 필드 신설 | **① 넣지 않음.** 원본 JSON 에 필드가 없다(`low-level-design.md:91`). ②는 섬 외양 공개 범위 결정을 랭킹이 대신 내리는 것이라 별도 승인 사안 |

**레포 선례**

- `../api-platform/policy.md:52` — 403 `FACILITY_LOCKED` 행(「필요한 시설 미해금. field=null, 도메인 선행 조건 확인」). (c) 의 근거.
- `league/service/LeagueService.java:155` — 기존 리그에 「평균 표시 반올림」 선례가 없다(정수 초를 그대로 쓴다). (a) 는 **새로 정하는 것**이지 기존 규칙을 따르는 게 아니다.

**늦어지면 못 나가는 것**: 공개 DTO 확정. 기획 v1 프레임 58(섬 간 랭킹)이 그려지지 않는다.
(a)~(d) 는 서로 독립이라 **(b)(c)(d) 는 오늘 바로 확정 가능**하고 실제로 셋 다 이미 문서가 한 방향을 금지해 두었다.

---

## 3. 결정과 무관한 배포 선행 조건 — `business.cursor.enabled`

**이 워크트리(기준 main) 전체에 `business.cursor.enabled` 문자열이 0건이다.**
`*.yml`·`*.yaml`·`*.java` 를 business-api·data-api·notification·realtime 전부 훑어 **정의도 없고 `@Value`/`@ConfigurationProperties` 로 읽는 코드도 없다**.

GROMO-1759 가 **CI 프로파일에만** 이 스위치를 켠 상태이고 그 브랜치는 아직 리뷰 대기라 main 에 없다.
즉 dev/prod 주입은 **아직 아무도 소유하지 않은 배포 선행 조건**이다. RK-D01~D06 중 어느 것도 이걸 해결하지 못한다 —
1777 의 cursor 계약(`low-level-design.md:120-125`, 15분 HMAC cursor)이 실제로 켜지려면 1759 머지 **이후** 누군가 dev/prod yml 에 값을 넣어야 한다.

같은 성격의 미소유 항목 하나 더: **내부 호출 허용목록이 런타임 설정에 비어 있다.**
`config/InternalApiProperties.java:31-49` 가 `@ConfigurationProperties(prefix = "internal.api")` 로 `callers.<name>.allow`(`"METHOD /internal/…"` 목록)를 받는데,
`server/data-api/src/main/resources/` 의 어떤 `application*.yml` 에도 실제 `allow` 항목이 없다(`application-ci.yml:65` 에 플래그 이름을 언급한 주석만 있다).
값은 테스트 코드에서만 채워진다(`config/InternalAuthFilterTest.java:49,198,241,257,272`, `internal/InternalSurfaceIntegrationTest.java:79`).
따라서 **rankings 항목이 없는 게 아니라 목록 자체가 비어 있다** — 1777 이 내부 경로를 추가할 때 이 허용목록 주입도 같이 소유자를 정해야 한다.

반면 공개 경로는 이미 열려 있다: `business-api/.../common/api/PublicApiRoutes.java:14-17` 의 `ROOTS` 에 `"/rankings/**"` 가 **이미 포함**되어 있다(16줄).

---

## 4. 문서·티켓 서술과 실제가 다른 지점

| # | 어긋난 곳 | 실제 |
| --- | --- | --- |
| 1 | **주민 랭킹 화면이 폐지됐는데 랭킹 문서가 모른다** | `../bff-screens/policy.md` B23 이 「전망대 주민 랭킹 폐지(island-rankings)」를 기획 v0.6 정책 변경으로 기록하고, `../bff-screens/planning-v1-mapping.md:63` 이 「섬 내 주민 랭킹(`GET /islands/{islandId}/rankings/members`, v0.3 "tower" 화면 전용)은 기획 v1 98계약에 없다 — B23 …과 맞물려 화면 자체가 B15 로 폐지됐으므로」라고 적는다. 그런데 `island-rankings/` 문서에는 「폐지」·「B15」·「B23」 문자열이 **0건**이다(grep 확인). prd·policy·LLD 가 여전히 2계약을 살아 있는 것으로 서술한다 |
| 2 | **티켓 GROMO-1777 이 폐지된 계약을 여전히 요구** | 요약 「섬 내 주민 랭킹·섬 간 랭킹 2종」, 완료 조건에 「최소 인원 미달 섬이 정해진 방식으로 응답한다」가 그대로 있다. 티켓 최종 수정 `2026-09-13`, B15/B23/B25 결정은 `2026-09-15~16` — **티켓이 결정보다 먼저 멈춰 있다** |
| 3 | **티켓의 참고 경로가 존재하지 않는다** | 티켓 본문 `docs/prd/island-ranking/`·`docs/prd/api-platform/`. 실제는 `docs/prd/fishcat/island-rankings/`·`docs/prd/fishcat/api-platform/`. README 도 「티켓의 island-ranking 대신 배정 경로 island-rankings 를 사용한다」로 한 번 정정했으나 `fishcat/` 단이 빠져 있다 |
| 4 | `LeagueRankSnapshot` 의 유니크 키 서술 | 「`(user_id, rank, date)`」로 알려져 있으나 실제는 `uq_league_rank_snapshots_user_day (user_id, created_at)` (`LeagueRankSnapshot.java:21-26`). `rank` 는 유니크에 없다. **재사용 불가라는 결론은 그대로**다 — 사용자×날짜당 rank 한 개를 덮어쓰는 구조라 주간 불변 페이지 정본이 될 수 없다 |
| 5 | 다음 마이그레이션 번호 | 현재 최고가 `V58__focus_session_lifecycle.sql` 이므로 **V59** 가 맞다(확인함). D01 이 유일하게 이 번호를 쓴다 |

**1 번이 이 문서에서 가장 큰 항목이다.** RK-D01(최소 2명·myRank 대상)·RK-D02(동점)·RK-D06(c)(eligibility) 는
**폐지된 members 화면에만 쓰이는 갈래를 포함**한다. members 계약을 정말 접는다면 D01 은 「섬 평균 분모」만,
D06(c) 는 `eligibility` 필드 자체가 사라지고, D02 는 섬 간 랭킹에만 적용된다 — **결정해야 할 양이 절반으로 준다.**
그래서 **RK-D01~D06 보다 먼저 답해야 할 질문은 「members 계약을 접는가」**다. 이 문서는 그 답을 대신 내리지 않는다.

---

## 5. 근거를 찾지 못한 것 — 「근거 없음」

- **`business.cursor.enabled`** — 이 워크트리 어디에도 없음(§3).
- **내부 허용목록의 rankings 항목** — 목록 자체가 런타임 설정에 비어 있음(§3).
- **랭킹용 snapshot/lock 모듈** — `focus`·`island` 패키지에 전용 snapshot 클래스 없음. LLD §4 의 `public-statistics-snapshot-lifecycle` 공유/배타 잠금은 **아직 코드에 없는 신규 계약**이다(`low-level-design.md:134` 가 스스로 그렇게 적는다). 유일한 advisory lock 선례는 `notification/producer/ResultBundleCompletionService.java:183` — `String function = shared ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock";` (공유/배타를 한 줄에서 가르는 패턴이 그대로 재사용 가능).
- **facility(시설) 모델** — `server/data-api` 에 `*Facility*` 파일·`class Facility`·`interface Facility` 모두 0건. 전망대 해금 판정의 실제 근거가 아직 없다 → `FACILITY_LOCKED` 는 **코드가 아니라 문서로만 확정**된 상태다.
- **멤버십 코호트 이력** — `group_members` 는 유저×섬당 1행이고 `left_at` 이 없으며 `rejoin()` 이 같은 행을 재사용한다(§2.1). 과거 주 주민 명단을 복원할 근거 **없음**.
- **RK-D04** — 이 문서 범위 밖이라 펼치지 않았다(미조사 아님, `policy.md:22` 에 기술만 있음).
