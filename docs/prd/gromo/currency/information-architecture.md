# 재화(시간조각) — IA (Information Architecture)

> 현재 구현 상태 기준 · 2026-08-08 `main`
> 시리즈: **IA** · [PRD](./prd.md) · [HLD](./high-level-design.md) · [LLD](./low-level-design.md)

**색 규칙** — 🟦 파랑 = 오스카 구현 · ⬜ 회색 = 조재영 구현 · 🟥 빨강 = 미구현/부채

---

## 1. 전체 정보 지도

```mermaid
mindmap
  root((시간조각 재화))
    저장
      user_wallets
        잔액 정본
        낙관락
      currency_transactions
        원장 append-only
        멱등키 UNIQUE
    사유 9종
      적립 6
      차감 2
      미배선 1
    API
      잔액 조회
      내역 조회
      earn no-op
      spend 구매
    지급 전달
      세션 응답
      스크린타임 응답
      리그 응답
      내기 푸시
    클라 상태
      CoinProvider
        coins
        coinsLoaded
        coinsVersion
      로컬 보유아이템
    화면
      잔액 칩
      내역 화면
      플러스N 연출
```

---

## 2. 데이터 모델

```mermaid
erDiagram
    users ||--|| user_wallets : "1:1 지갑"
    users ||--o{ currency_transactions : "1:N 원장"

    users {
        uuid id PK "UUID v7"
        timestamptz deleted_at "탈퇴해도 행은 남는다"
    }

    user_wallets {
        uuid user_id PK "FK users.id"
        integer balance "잔액 default 0"
        bigint version "JPA 낙관락 · dbml 누락(코드가 정본)"
        timestamptz updated_at "UpdateTimestamp"
        timestamptz deleted_at "컬럼만 존재 · 미배선"
    }

    currency_transactions {
        uuid id PK "UUID v7"
        uuid user_id FK "FK users.id"
        integer amount "항상 양수 · 방향은 type이 표현"
        currency_type type "사유 9종 · CHECK 제약"
        varchar idempotency_key UK "UNIQUE · 이중지급 최후방어선"
        timestamptz created_at "거래 시각"
    }
```

### 2.1 잔액을 원장 합산으로 구하지 않는다

```mermaid
flowchart LR
    Q{"잔액을 어떻게<br/>구하는가"}
    Q -->|"미채택"| A["원장 SUM 집계<br/>정합 걱정 없음<br/>읽기 비용 큼"]
    Q ==>|"현재 구조"| B["별도 정본 컬럼<br/>읽기 저렴<br/>정합을 코드가 지켜야"]
    B --> C["그래서: 지갑 변경 + 원장 기입은<br/>항상 같은 트랜잭션"]

    classDef pick fill:#22c55e33,stroke:#22c55e,stroke-width:2px
    classDef drop fill:#9ca3af1a,stroke:#9ca3af,stroke-dasharray:4 3
    classDef note fill:#eab30833,stroke:#eab308
    class B pick
    class A drop
    class C note
```

잔액 조회는 앱에서 가장 빈번한 호출이라 읽기 비용을 택했다.

---

## 3. type 도메인 (9종)

```mermaid
flowchart TD
    subgraph SRV["🔒 서버 전용 · isServerOnly = true"]
        direction LR
        BS["BET_STAKE ▼"]:::jae
        BP["BET_PAYOUT ▲"]:::jae
        BR["BET_REFUND ▲"]:::jae
        FG["FOCUS_GOAL ▲"]:::oscar
        SG["SCREEN_TIME_GOAL ▲"]:::oscar
        LB["LEAGUE_TIER_BONUS ▲"]:::oscar
    end

    subgraph OPEN["🔓 클라 개방 · isServerOnly = false"]
        direction LR
        SC["SESSION_COMPLETE ▲"]:::jae
        PU["PURCHASE ▼"]:::jae
        ST["STREAK_BONUS<br/>미배선"]:::gap
    end

    GUARD{"/currency/earn · spend<br/>타입 화이트리스트"}:::jae
    SRV -.->|"타입 자체 거절"| GUARD
    OPEN -->|"통과"| GUARD

    classDef oscar fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef jae fill:#9ca3af26,stroke:#9ca3af
    classDef gap fill:#ef444433,stroke:#ef4444,stroke-dasharray:4 3
```

▲ 적립 · ▼ 차감

| type | 방향 | `isServerOnly` | 구현 |
|---|---|---|---|
| `SESSION_COMPLETE` | ▲ | false | ⬜ |
| `PURCHASE` | ▼ | false | ⬜ |
| `BET_STAKE` | ▼ | **true** | ⬜ |
| `BET_PAYOUT` | ▲ | **true** | ⬜ |
| `BET_REFUND` | ▲ | **true** | ⬜ |
| `FOCUS_GOAL` | ▲ | **true** | 🟦 |
| `SCREEN_TIME_GOAL` | ▲ | **true** | 🟦 |
| `LEAGUE_TIER_BONUS` | ▲ | **true** | 🟦 |
| `STREAK_BONUS` | ▲ | false | 🟥 **enum 값만 존재 · 지급 호출부 없음** |

- **`isServerOnly()`** = 금액·시점을 서버가 전적으로 결정하는 6종. 클라 경로에서 타입 자체를 거절한다.
- CHECK 제약은 Flyway `V22__currency_transaction_reward_types.sql`(🟦)이 관리한다.

---

## 4. 멱등키 네임스페이스

**"같은 사건은 같은 키"** — 사건의 자연 유일성을 키에 담는다.

```mermaid
flowchart LR
    ROOT(("멱등키<br/>컨벤션"))

    ROOT --> S["focus:{sessionId}:reward"]:::jae
    S --- Sn["세션 1건 = 지급 1회"]:::note

    ROOT --> G1["focusGoal:{userId}:{date}"]:::oscar
    ROOT --> G2["stGoal:{userId}:{date}"]:::oscar
    G2 --- Gn["목표 달성은 하루 1회"]:::note

    ROOT --> L["league:{weekStartAt}:{userId}"]:::oscar
    L --- Ln["승급은 주 1회"]:::note

    ROOT --> B1["bet:{betId}:stake:{userId}"]:::jae
    ROOT --> B2["bet:{betId}:payout:{userId}"]:::jae
    ROOT --> B3["bet:{betId}:refund:{userId}"]:::jae
    B3 --- Bn["내기당 유저당 1회"]:::note

    ROOT --> P["구매 — 키 없음"]:::gap
    P --- Pn["재화 도메인에 남은<br/>유일한 이중처리 구멍"]:::gapnote

    classDef oscar fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef jae fill:#9ca3af26,stroke:#9ca3af
    classDef gap fill:#ef444433,stroke:#ef4444,stroke-width:2px
    classDef note fill:#eab30833,stroke:#eab308
    classDef gapnote fill:#ef44441f,stroke:#f87171,stroke-dasharray:3 3
```

---

## 5. API 표면

```mermaid
flowchart LR
    APP(["📱 앱"])

    subgraph DIRECT["currency 도메인 직접 API"]
        A1["GET /currency<br/>잔액 number"]:::jae
        A2["GET /currency/transactions<br/>내역 · 페이지네이션 없음"]:::gap
        A3["POST /currency/earn<br/>no-op 204"]:::noop
        A4["POST /currency/spend<br/>PURCHASE만"]:::jae
    end

    subgraph RIDE["지급은 다른 도메인 응답에 얹혀 온다"]
        R1["POST /focus-session<br/>awardedCoins · goalRewardCoins"]:::oscar
        R2["스크린타임 저장<br/>지급 반영"]:::oscar
        R3["리그 결과 조회<br/>promotionBonusCoins"]:::oscar
        R4["내기 정산<br/>BET_RESULT 푸시"]:::jae
    end

    APP --> A1 & A2 & A4
    APP -.->|"구앱만 호출"| A3
    APP --> R1 & R2 & R3
    R4 -.->|"푸시"| APP

    NOTE["별도 '지급 API'가 없다 —<br/>지급은 항상 그 지급을 유발한<br/>행위의 응답에 실린다"]:::note
    RIDE --- NOTE

    classDef oscar fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef jae fill:#9ca3af26,stroke:#9ca3af
    classDef gap fill:#ef444433,stroke:#ef4444
    classDef noop fill:#9ca3af1a,stroke:#9ca3af,stroke-dasharray:4 3
    classDef note fill:#eab30833,stroke:#eab308
```

### 5.1 조회 데이터 왕복

```mermaid
sequenceDiagram
    autonumber
    participant V as 화면
    participant C as CoinProvider 🟦
    participant API as InGameCurrencyController ⬜
    participant W as user_wallets
    participant L as currency_transactions

    rect rgba(59, 130, 246, 0.14)
    note over V,C: 잔액 — 화면 포커스마다
    V->>C: useRefreshCoinsOnFocus
    C->>API: GET /api/v1/currency
    API->>W: findById(userId)
    W-->>API: balance
    API-->>C: 200 number
    C->>C: coins 갱신 · coinsLoaded=true · version++
    C-->>V: 잔액 칩 ⏳N
    end

    rect rgba(148, 163, 184, 0.14)
    note over V,L: 내역 — 화면 진입 시
    V->>API: GET /api/v1/currency/transactions
    API->>L: findByUserOrderByCreatedAtDesc
    L-->>API: 전량 (페이지네이션 없음)
    API-->>V: amount · type · createdAt[]
    V->>V: 부호는 type에서 유도
    end
```

### 5.2 앱 DTO 미러 🟦

```typescript
export type CurrencyTransactionType =
  | 'SESSION_COMPLETE' | 'STREAK_BONUS' | 'PURCHASE'
  | 'BET_STAKE' | 'BET_PAYOUT' | 'BET_REFUND'
  | 'FOCUS_GOAL' | 'SCREEN_TIME_GOAL' | 'LEAGUE_TIER_BONUS'
  | (string & {});          // ← 서버 enum 확장 도착 시에도 타입이 깨지지 않게

export interface CurrencyTransaction {
  amount: number;    // 항상 양수 — 방향은 type이 표현
  type: CurrencyTransactionType;
  createdAt: string; // Instant ISO
}
```

**`(string & {})`** — 미지의 enum 값이 도착해도 타입을 깨지 않으면서 알려진 값의 자동완성은 유지한다.
서버가 type을 확장 배포했는데 앱이 구버전인 상황을 언어 차원에서 흡수한다.

---

## 6. 클라 상태 구조 🟦

```mermaid
classDiagram
    class CoinContextValue {
        +number coins
        +boolean coinsLoaded
        +number coinsVersion
        +latestCoinsVersion() number
        +refresh() Promise~boolean~
        +isOwned(itemId) boolean
        +buyItem(itemId, price) Promise~boolean~
    }
    class 내부_ref {
        refreshSeqRef : 조회 시퀀스
        coinsVersionRef : 버전 정본
    }
    class 소비자 {
        홈·메뉴 잔액칩
        내역 화면
        BetSheet 부족검사
        GroupRoom 정산서명
    }
    내부_ref --> CoinContextValue : 정본은 ref · state는 사본
    CoinContextValue --> 소비자 : Context
```

| 노출값 | 의미 | 왜 필요한가 |
|---|---|---|
| `coins` | 서버 잔액 (표시용, **정본 아님**) | |
| `coinsLoaded` | 한 번이라도 받아왔나 | `false`면 `coins=0`은 '0코인'이 아니라 **'모름'** |
| `coinsVersion` | 몇 번째로 받은 값인가 (state) | 서버 판정을 풀어도 되는지는 **크기가 아니라 도착 순서**로 갈린다 |
| `latestCoinsVersion()` | 지금 이 순간의 버전 (ref) | state는 응답 적용~다음 렌더 사이 한 틱 낡는다 |
| `refresh()` | 서버 재조회 | 반환값 = **이 호출의 잔액이 실제로 반영됐는가** |

### 6.1 `coinsLoaded`가 갈라내는 네 가지 0

```mermaid
stateDiagram-v2
    [*] --> 모름 : Provider 마운트
    모름 --> 확정 : refresh 성공
    확정 --> 모름 : refresh 실패
    확정 --> 확정 : refresh 성공 · version++

    note right of 모름
        coins = 0
        coinsLoaded = false
        화면은 잔액을 말하지 않는다
    end note
    note right of 확정
        coins = 서버값
        coinsLoaded = true
        잔액으로 사용자를 잠글 수 있다
    end note
```

`coins = 0`이 될 수 있는 경로가 넷 — **진짜 0코인 · 최초 로드 실패 · refresh 실패 · 응답 전.**
이 넷이 같은 숫자로 뭉개지면 화면이 사용자의 재산에 대해 거짓을 말한다.

### 6.2 로컬 저장 구조 (보유 아이템)

아이템 API가 없어 **로컬이 유일한 구매 기록**이다.

```mermaid
flowchart TD
    W(["구매 발생"]):::oscar --> Q{"쓰기 큐<br/>읽기-수정-쓰기 직렬화"}:::oscar
    Q --> V2["gromo:ownedItemsV2<br/>Record&lt;userId, string[]&gt;<br/><b>정본 · 계정별 분리</b>"]:::oscar
    Q --> LEG["gromo:ownedItems<br/>string[]<br/>듀얼라이트"]:::oscar
    Q --> OWN["gromo:ownedItemsLegacyOwner<br/>userId"]:::oscar

    LEG -.->|"OTA 롤백된 구 번들이 읽음"| OLD(["구 앱 번들"]):::note
    OWN -.->|"복귀 후 정확한 버킷으로 병합"| V2
    GUEST["게스트 UUID 버킷"]:::oscar -->|"소셜 승격 시<br/>합집합 인계"| V2

    classDef oscar fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef note fill:#eab30833,stroke:#eab308
```

고정 `guest` 버킷을 쓰지 않는 이유: 게스트 로그아웃 후에도 남아 **다음 게스트·무관한 소셜 계정에 누출**된다.

---

## 7. 화면 IA

```mermaid
flowchart TD
    HOME["🏠 홈"]:::screen
    MENU["☰ 전체(메뉴) 탭"]:::screen
    RESULT["🎯 집중 결과"]:::screen
    LEAGUE["🏆 리그 결과"]:::screen
    ROOM["👥 그룹방"]:::screen

    HOME -->|"오늘 카드"| CHIP1["잔액 칩 ⏳N"]:::oscar
    MENU --> CHIP2["잔액 칩 ⏳N"]:::oscar
    CHIP2 -->|"탭"| HIST["📜 재화 내역 화면"]:::oscar
    HIST --> LIST["거래 리스트<br/>사유 라벨 · 부호 · 금액 · 시각"]:::oscar

    RESULT --> B1["+N 배지<br/>세션 보상 + 목표 보너스 합산"]:::oscar
    RESULT -.->|"홈 복귀"| GOALM["🎉 목표 축하 모달<br/>+N"]:::oscar
    HOME -.-> STM["🎉 스크린타임 축하 모달<br/>+N"]:::oscar
    LEAGUE --> B4["+N 승급 보너스<br/>서버 실지급액"]:::oscar
    ROOM --> SHEET["💸 내기 시트<br/>잔액 검사 · INSUFFICIENT_CURRENCY"]:::jae

    classDef oscar fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef jae fill:#9ca3af26,stroke:#9ca3af
    classDef screen fill:#9ca3af14,stroke:#94a3b8,stroke-width:2px
```

### 7.1 표시 규칙 🟦

```mermaid
flowchart LR
    T(["거래 1건<br/>amount는 항상 양수"]) --> D{"type이<br/>무엇인가"}
    D -->|"PURCHASE · BET_STAKE"| M["− 표시"]:::minus
    D -->|"그 외 7종"| P["+ 표시"]:::plus
    D --- NOTE["부호는 금액이 아니라<br/>type에서 유도한다"]:::note

    classDef minus fill:#ef444433,stroke:#ef4444
    classDef plus fill:#22c55e33,stroke:#22c55e
    classDef note fill:#eab30833,stroke:#eab308
```

| 규칙 | 내용 |
|---|---|
| **부호 유도** | `PURCHASE`·`BET_STAKE` = −, 나머지 = + |
| **잔액 재조회 시점** | Provider 마운트 1회 + **잔액 표시 화면 포커스마다**. 서버가 깎은 잔액은 마운트 1회로는 영영 반영되지 않는다 |
| **아이콘** | `CurrencyIcon` 컴포넌트 — 이모지 ⏳는 기기·폰트마다 모양이 달라 쓰지 않는다 |
| **라벨** | `CURRENCY.label = '시간조각'`. 코드 식별자는 `coin`/`currency` |
| **미도착 처리** | 지급값이 안 오면 graceful **배지 미표시** — 0을 지어내지 않는다 |
