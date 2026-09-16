# High-Level Design — 리그

> 작성 2026-08-09 · 현재 구현 상태 기준
> 세트: [IA](information-architecture.md) · [PRD](prd.md) · **HLD** · [LLD](low-level-design.md)

## 1. 시스템 컨텍스트

```mermaid
flowchart LR
    subgraph Device["iOS 기기"]
        LS["리그 탭<br/>LeagueScreen"]
        FP["FriendProfile · TierGuide<br/>LeagueResult · FriendAdd"]
        FS["집중 세션 화면<br/>(focus 도메인)"]
    end
    subgraph Server["Spring Boot"]
        LC["LeagueController<br/>/api/v1/league/*"]
        FC["FriendController · PinController<br/>/api/v1/friends* · /pins*"]
        SCHED["@Scheduled<br/>월 00:00 KST 정산 배치"]
        PUSH["@Scheduled<br/>월 07:00 KST 결과 푸시"]
        BATCH["LeagueBatchController<br/>run · resume (비prod)"]
    end
    DB[("PostgreSQL<br/>daily_focus_stats · users.tier_level<br/>league_weekly_results · pinned_users")]

    LS -->|"포커스마다 5계열 조회"| LC & FC
    FP --> LC & FC
    FS -->|"60초 폴링"| LC & FC
    LC & FC --> DB
    SCHED --> DB
    BATCH -.->|"수동 복구"| SCHED
    PUSH -.->|FCM| Device

    NOTE["점수 원천은 리그 전용 테이블이 아니라<br/><b>daily_focus_stats 합계</b> — 리그는 집중 도메인의 파생이다"]:::note
    DB --- NOTE
    classDef note fill:#eab30833,stroke:#eab308
```

- **리그는 저장소를 거의 갖지 않는다.** 주간 점수는 `daily_focus_stats`를 매 조회 집계하고, 리그가 소유한 영속 상태는 `users.tier_level` + `league_weekly_results`(정산 결과) + `league_arenas`(주차 anchor)뿐이다.
- **아레나는 "그룹"이 아니라 "주차 마커"다.** 멤버십 테이블(`league_arena_users`)은 V14에서 제거됐고, 남은 `league_arenas`는 주차마다 1행씩 도는 anchor다.
- WS/SSE 없음 — 랭킹 갱신은 화면 포커스 재조회 + 세션 화면 60초 폴링.

## 2. 화면 구성과 데이터 흐름

```mermaid
sequenceDiagram
    autonumber
    participant U as 사용자
    participant LS as LeagueScreen
    participant H as use* 훅 5종
    participant API
    U->>LS: 리그 탭 진입 (useFocusEffect)
    par 병렬 5계열
        H->>API: GET /league/me/tier + /league/me/schedule
        H->>API: GET /league/me/ranking?category&date
        H->>API: GET /league/ranking?scope=total&limit=100
        H->>API: GET /pins?date
        H->>API: GET /friends?date + /friends/requests?type=received
    end
    H->>API: GET /focus-session (주 시작 −24h ~ now)
    Note over H: 내 주간 집중초를 세션 합산으로 별도 계산
    H->>API: GET /league/me/last-result
    alt hasResult && !acknowledged
        LS-->>U: LeagueResult 자동 진입 (연출)
        U->>LS: 닫기 → POST /league/me/last-result/ack
    end
    LS-->>U: 포디움 + sticky 내 순위 + 랭킹 리스트
```

**한 번의 탭 진입이 최대 8~9개 요청을 낸다.** 홈 화면도 `useLeagueMeta`·`useLeagueRanking`을 마운트하므로 같은 조회가 화면마다 중복된다(공유 캐시 없음 — §9).

## 3. 훅 계층 구조

```mermaid
flowchart TD
    subgraph API_L["서비스 계층 (services/)"]
        LA["leagueApi.ts"]:::api
        FA["friendsApi.ts"]:::api
    end
    subgraph HOOK_L["훅 계층 (screens/league/)"]
        H1["useLeagueMeta<br/>티어 + 마감 카운트다운"]:::hook
        H2["useLeagueRanking<br/>직군 랭킹 + 내 권위 주간분"]:::hook
        H3["useGlobalRanking<br/>전역 랭킹"]:::hook
        H4["useLeagueLastResult<br/>미확인 결과 감지 → 네비게이트"]:::hook
        H5["usePinned<br/>핀 집합 + 낙관 토글"]:::hook
        H6["useFriends<br/>친구 목록 + 요청 수"]:::hook
        H7["useFocusFriends<br/>세션 그리드용 친구 라이브"]:::hook
    end
    subgraph SCR["화면"]
        S1["LeagueScreen"]:::scr
        S2["TierGuideScreen"]:::scr
        S3["HomeScreen (타 도메인)"]:::scr
        S4["FocusSessionScreen (타 도메인)"]:::scr
    end
    LA --> H1 & H2 & H3 & H4
    FA --> H5 & H6 & H7
    H1 & H2 & H3 & H4 & H5 & H6 --> S1
    H1 & H2 --> S2
    H1 & H2 --> S3
    H7 --> S4

    classDef api fill:#9ca3af26,stroke:#9ca3af
    classDef hook fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef scr fill:#9ca3af14,stroke:#94a3b8,stroke-width:2px
```

| 훅 | 책임 | 갱신 트리거 | 실패 정책 |
|---|---|---|---|
| `useLeagueMeta` | 티어 1건 + 마감까지 남은 초. **1초 로컬 카운트다운**을 스스로 돈다 | 화면 포커스 · pull-to-refresh | 중립 티어(레벨 null)·마감 null 유지, 조용히 무시 |
| `useLeagueRanking` | 직군 top-100 + **내 주간 집중초(세션 합산)** + 리그 라벨 | 화면 포커스 · pull-to-refresh | 이전 목록 유지 + `error=true`. **단 카테고리가 바뀐 뒤 실패면 비운다** |
| `useGlobalRanking` | 전역 top-100 | 화면 포커스 · pull-to-refresh | 이전 목록 유지 + `error=true` |
| `useLeagueLastResult` | 조회 후 **네비게이션 부수효과만** — 상태를 반환하지 않는다 | 화면 포커스 | 조용히 무시, 다음 포커스 재시도 |
| `usePinned` | 핀 ID 집합 + 낙관 토글. in-flight·세대 가드 2중 | 화면 포커스 · 토글 | 상태 유지 / 토글 실패는 롤백 + Alert |
| `useFriends` | 친구 목록 + 받은 요청 수 (`allSettled`로 부분 실패 허용) | 화면 포커스 · pull-to-refresh | 목록 유지 + `error=true`. 요청 수 실패는 에러로 올리지 않음 |
| `useFocusFriends` | 친구 전체 라이브 + 핀 ID 집합 | 60초 인터벌 · 포그라운드 복귀 | 상태 유지 |

**공통 규율 — 요청 시퀀스 가드.** 포커스 재조회와 pull-to-refresh가 겹칠 때 늦게 도착한 이전 응답이 최신 상태를 덮지 않도록, 훅마다 `requestSeqRef`로 stale 응답을 버린다(`useLeagueRanking.ts:109,138`).

**책임 분리의 예외 하나** — `useLeagueLastResult`는 값을 반환하지 않고 `navigation.navigate`를 직접 호출한다. "조회 결과에 따라 화면을 띄운다"가 이 훅의 전부라, 호출부에 조건 분기를 넘기면 같은 로직이 화면마다 복제된다.

## 4. 주간 경계와 KST 시간 축

```mermaid
flowchart LR
    subgraph CLI["앱"]
        C1["leagueWeekStart()<br/>UTC+9 오프셋 산술"]
        C2["todayStrKst()<br/>Intl 포매터"]
    end
    subgraph SRV["서버"]
        S1["LeagueWeek<br/>ZoneId Asia/Seoul<br/>previousOrSame(MONDAY)"]
        S2["daily_focus_stats.date<br/>KST 일 버킷"]
    end
    C1 -.->|"같은 순간을 가리켜야 함"| S1
    C2 -.->|"date 파라미터"| S2

    G["⚠️ 앱은 오프셋 산술(9h 고정),<br/>서버는 달력 산법(ZoneId).<br/>KST엔 DST가 없어 현재는 동치"]:::note
    C1 --- G
    classDef note fill:#eab30833,stroke:#eab308
```

- **주 경계**: 양쪽 모두 KST 월요일 00:00. 앱은 `Date.now() + 9h`로 벽시계를 옮긴 뒤 월요일 00:00으로 내리고 되돌린다(`useLeagueRanking.ts:55-60`). 서버는 `LocalDate.with(previousOrSame(MONDAY)).atStartOfDay(KST)`.
- **경계를 걸친 세션**: 서버 세션 조회는 `startedAt` 필터라, 일요일 밤 시작 → 월요일 종료 세션이 새 주 조회에서 빠진다. 앱은 **주 시작 −24시간**부터 받아 `endedAt ≥ weekStart`로 재필터한다. 서버 주간 집계는 `daily_focus_stats`의 **일 버킷** 합이라 그 세션도 새 주에 들어간다 — 두 정의를 맞추는 보정이다.
- **일 축**: 라이브 '당일 집중분'의 기준일도 KST(`todayStrKst()`). 계약 테스트(`services/leagueApi.test.ts`)가 로컬 날짜 유출을 막는다.
- **한계**: 서버 일 버킷의 존은 `country_code` 파생이라 KR이 아닌 유저는 KST가 아닐 수 있다. 앱은 KST를 정본 축으로 통일해 보낸다.

## 5. 정산 파이프라인과 멱등성

```mermaid
flowchart TD
    START(["월 00:00 KST cron"]) --> CFG{"티어 설정 1~5<br/>전부 있나"}
    CFG -->|"없음"| ERR["TIER_CONFIG_NOT_FOUND<br/>anchor 생성 전에 중단"]:::err
    CFG -->|"있음"| ROT["anchor 회전 (별도 트랜잭션 선커밋)<br/>이전 ACTIVE 종료 + 신주차 anchor 생성"]:::step
    ROT -->|"이미 있음"| DUP["BATCH_ALREADY_RUN 409"]:::err
    ROT --> PAGE["100명씩 keyset 페이지 순회<br/>daily_focus_stats 주간 합계"]:::step
    PAGE --> PRE["① 완료 마커 페이지 선조회<br/>(빠른 경로 · N+1 방지)"]:::g1
    PRE --> LOCK["② 유저 행 배타 락"]:::g2
    LOCK --> RECHECK["③ 락 안에서 마커 단건 재확인<br/><b>동시성 정본</b>"]:::g2
    RECHECK --> DECIDE["판정 · 티어 갱신 · 보너스 · 결과 저장<br/>(한 트랜잭션)"]:::step
    DECIDE --> UQ["④ UNIQUE(user_id, week_start_at)<br/>최후 방어선"]:::g3

    classDef step fill:#3b82f633,stroke:#3b82f6
    classDef g1 fill:#9ca3af26,stroke:#9ca3af
    classDef g2 fill:#22c55e33,stroke:#22c55e,stroke-width:2px
    classDef g3 fill:#eab30833,stroke:#eab308
    classDef err fill:#ef444433,stroke:#ef4444
```

**멱등이 4겹인 이유** — 각 층이 막는 사고가 다르다.

| 층 | 막는 것 | 못 막는 것 |
|---|---|---|
| ① 페이지 선조회 | 이미 정산된 유저에 대한 불필요한 락·쿼리 | 동시 재실행 (조회~락 사이 창) |
| ② 배타 락 | 탈퇴 레이스, 지갑 삭제 레이스, lost update | 자기 혼자서는 중복 판정을 못 막음 |
| ③ 락 안 마커 재확인 | **연쇄 승급(래칫)** — 이미 승급된 티어로 다시 판정하는 것 | — (동시성 정본) |
| ④ UNIQUE 제약 | 위 셋이 뚫렸을 때의 이중 결과 행 | flush 시점 예외라 트랜잭션 전체 롤백 |

**판정 기준 티어는 스냅샷이 아니라 락으로 잡은 행이다.** 페이지 조회 시점의 `tierLevel`을 쓰면 락 대기 중 커밋된 다른 주차 정산(예: 과거 주차 resume의 승급)을 놓친다. 락을 두 번째로 잡는 쪽이 항상 커밋된 진실 위에서 판정하도록 재조회한다.

**결과 4갈래** — `SETTLED` / `ALREADY_SETTLED`(같은 주차 기정산) / `SKIPPED_SUPERSEDED`(더 늦은 주차가 이미 정산됨 → 소급 금지) / `SKIPPED_WITHDRAWN`(집계 후 탈퇴). boolean 두 갈래로는 "이미 정산됨"을 표현할 수 없어 enum으로 넓혔다.

**resume은 절대 회전하지 않는다.** 복구 진입점은 대상 주차의 run이 커밋한 **가드 anchor**(= 대상 주차 + 1주)의 존재를 확인하고, 없으면 `BATCH_NOT_RUN`(409)으로 거절한다. 또 `created_at < 주차 종료 경계` 컷오프로 **주차 종료 후 가입자의 0초 STAY 조작**을 막는다.

**유저 단위 롤백** — 한 명이 예외로 터져도 그 유저만 롤백되고 나머지는 계속된다. 이를 위해 배치 오케스트레이터(`LeagueBatchService`)와 건별 트랜잭션(`LeagueUserSettler`)이 **클래스로 분리**돼 있다 — 자기 호출은 프록시를 타지 않아 `@Transactional`이 성립하지 않기 때문.

## 6. 결과 연출의 1회성

```mermaid
stateDiagram-v2
    [*] --> 조회 : 리그 탭 포커스
    조회 --> 없음 : hasResult=false
    조회 --> 확인됨 : acknowledged=true
    조회 --> 신규 : 미확인 && shownWeek ≠ weekStartAt
    조회 --> 재조회됨 : 미확인 && shownWeek == weekStartAt
    신규 --> 연출 : navigate(LeagueResult)
    연출 --> ack : 화면 unmount (CTA·제스처 공통)
    재조회됨 --> ack : 재노출 없이 ack만 재시도
    ack --> [*]
```

**두 개의 가드가 서로를 보완한다.** 서버 `acknowledged`는 기기가 바뀌어도 유지되지만 ack 요청이 실패하면 갱신되지 않는다. 앱 세션 내 `shownWeek` ref는 그 실패 창에서 같은 연출이 반복되는 것을 막는다. ack는 조건부 원자 UPDATE(`acknowledgedAt IS NULL`)라 중복 호출이 안전하다.

## 7. 실패와 빈 상태의 분리

```mermaid
flowchart LR
    R(["조회 결과"]) --> D{"성공?"}
    D -->|"성공 · 빈 배열"| E["'아직 이 리그엔 아무도 없어요'<br/>정상 빈 상태"]:::ok
    D -->|"실패 · 기존 목록 있음"| K["기존 목록 유지<br/>안내 없음"]:::warn
    D -->|"실패 · 목록 없음"| F["'불러오지 못했어요' + 다시 시도"]:::err

    classDef ok fill:#22c55e33,stroke:#22c55e
    classDef warn fill:#eab30833,stroke:#eab308
    classDef err fill:#ef444433,stroke:#ef4444
```

리그가 소셜 기능이라 **"실패"가 "아무도 없음"으로 보이면 서비스가 죽은 것처럼 보인다.** 랭킹(`LeagueScreen.tsx:558-572`)·친구 목록(`:620-626`)이 같은 패턴을 공유한다. 게스트는 실패가 아니라 정상 빈 상태로 취급해 에러 안내를 띄우지 않는다.

## 8. 앞으로 변할 방향

```mermaid
flowchart TD
    NOW["현행 — 포커스 재조회 · 화면별 독립 훅"] --> T{트리거?}
    T -->|"요청 수·중복 조회가 문제"| C["훅 상태의 공유 캐시화<br/>(홈·리그·티어가이드 통합)"]
    T -->|"멀티 인스턴스 전환 (티켓 565)"| L["배치 분산 락<br/>(현재는 anchor UNIQUE가 우발적 방어)"]
    T -->|"유저 증가로 top-100이 무의미"| A["아레나 분할<br/>league_arenas에 그룹핑 부활"]
    T -->|"티어 체계 변경 필요"| M["티어 메타 서버 이관<br/>(현재 이름·구간은 앱 상수)"]
    T -->|트리거 없음| S["현행 유지"]
```

## 9. 트레이드오프 및 한계

| 결정 | 트레이드오프 | 한계 (수용) |
|---|---|---|
| 리그 전용 점수 테이블 없음 | 집중 도메인과 항상 정합 ↔ 조회마다 집계 | 주간 랭킹 쿼리가 `daily_focus_stats` 스캔이다. 유저 증가 시 스냅샷 테이블이 필요해진다 |
| 화면별 독립 훅 (공유 캐시 없음) | 훅이 단순하고 화면 간 결합 0 ↔ 같은 조회 중복 | 리그 탭 1회 진입 = 8~9 요청, 홈도 별도로 2 요청. 세션 전량 조회는 특히 무겁다 |
| 포커스 재조회 (구독 없음) | 구현 단순 · 항상 최신 ↔ 실시간성 없음 | 화면에 머무는 동안 순위가 갱신되지 않는다 (세션 화면만 60초 폴링) |
| 승강 = 절대 시간 임계값 | 판정이 결정적·설명 가능 ↔ 경쟁 실감 약화 | 랭킹 UI가 주는 "순위=승급" 기대와 어긋난다. 가이드 문구가 실제로 틀려 있다 (PRD §4.2) |
| 배치 분산 락 없음 (티켓 565) | 단일 인스턴스에서 단순 ↔ 스케일아웃 시 재작업 | 동시 실행 시 anchor UNIQUE가 하나만 통과시키지만, 스케줄러가 예외를 잡지 않아 스택트레이스가 뜬다 |
| `promotionBonusCoins` 조회 시 재계산 | 미지급 케이스를 0으로 정직하게 보고 ↔ 저장값 아님 | 멱등키 문자열 포맷이 정산부와 문자 단위로 일치해야 한다. 보상 공식이 바뀌면 **과거 결과의 표시 금액이 소급 변경**된다 |
| 전역 랭킹에 라이브·핀 없음 | 전역 쿼리 비용 절감 ↔ 표현 비대칭 | 같은 `RankRow` 컴포넌트가 탭에 따라 다른 정보량을 그린다 |
