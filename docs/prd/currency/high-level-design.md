# 재화(시간조각) — HLD (High-Level Design)

> 현재 구현 상태 기준 · 2026-08-08 `main`
> 시리즈: [IA](./information-architecture.md) · [PRD](./prd.md) · **HLD** · [LLD](./low-level-design.md)

**색 규칙** — 🟦 파랑 = 오스카 구현 · ⬜ 회색 = 조재영 구현 · 🟥 빨강 = 부채

---

## 1. 설계 원칙

```mermaid
flowchart TD
    ROOT["재화 금액은 서버만 정한다<br/>클라는 표시만 한다"]:::root

    ROOT --> W["왜"]:::why
    W --> W1["클라가 금액을 실어 보내는 경로가<br/>하나라도 열려 있으면"]:::why2
    W1 --> W2["원장에 정산 기입과<br/>구분되지 않는 행이 섞인다"]:::why2
    W2 --> W3["'에스크로된 판돈 합계 = 지급 합계'를<br/><b>사후에 검증할 수 없게 된다</b>"]:::bad

    ROOT --> D1["파생 1<br/>금액 공식은 한 곳에만"]:::d
    ROOT --> D2["파생 2<br/>잔액 변경과 원장 기입은<br/>분리 불가능"]:::d
    ROOT --> D3["파생 3<br/>재실행은 정상 흐름"]:::d

    D1 --> I1["CurrencyRewardPolicy 단일 소유 🟦"]:::impl
    D2 --> I2["같은 트랜잭션 · 전파 REQUIRED"]:::impl
    D3 --> I3["멱등키를 예외가 아니라 스킵으로"]:::impl

    classDef root fill:#f59e0b33,stroke:#f59e0b,stroke-width:3px
    classDef why fill:#f59e0b1f,stroke:#fbbf24
    classDef why2 fill:#f59e0b14,stroke:#fcd34d
    classDef bad fill:#ef444433,stroke:#ef4444,stroke-width:2px
    classDef d fill:#6366f133,stroke:#6366f1,stroke-width:2px
    classDef impl fill:#6366f11f,stroke:#818cf8
```

이것이 `/currency/earn`을 API 제거 없이 **no-op으로까지 만들어 막은** 이유다.

---

## 2. 컴포넌트 구성

```mermaid
flowchart TD
    subgraph TRIG["지급을 트리거하는 도메인 — 금액을 계산하지 않는다"]
        direction LR
        F["FocusService<br/>세션 완료 · 집중 목표"]:::mix
        S["ScreenTimeService<br/>스크린타임 목표"]:::oscar
        LG["LeagueUserSettler<br/>주간 승급"]:::mix
        BS["GroupBetSettler<br/>내기 정산 지급"]:::jae
        BV["GroupBetService<br/>참가비 차감 · 환불"]:::jae
    end

    POL["CurrencyRewardPolicy<br/>순수 static · Spring 무관<br/><b>금액 공식 단일 소유</b>"]:::oscar
    LED["CurrencyLedgerService<br/>전파 REQUIRED<br/><b>멱등 판정 + 지갑·원장 동시 반영</b>"]:::mix

    WAL[("user_wallets<br/>잔액")]:::db
    TX[("currency_transactions<br/>원장 + 멱등키 UNIQUE")]:::db

    F & S & LG --> POL
    POL -->|"금액"| LED
    F & S & LG & BS & BV -->|"사유 · 금액 · 멱등키"| LED
    LED --> WAL & TX

    subgraph OPENP["클라 개방 경로 — 별도 계열"]
        ING["InGameCurrencyService<br/>earn → no-op<br/>spend → PURCHASE만"]:::jae
        ING -->|"원장 직접 기입<br/>멱등키 없음"| GAPN["🟥 원장 규율 밖"]:::gap
    end
    ING --> WAL & TX

    classDef oscar fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef jae fill:#9ca3af26,stroke:#9ca3af
    classDef mix fill:#6366f133,stroke:#6366f1
    classDef db fill:#f59e0b33,stroke:#f59e0b,stroke-width:2px
    classDef gap fill:#ef444433,stroke:#ef4444,stroke-width:2px
```

---

## 3. 왜 원장 서비스가 둘인가

```mermaid
flowchart LR
    subgraph A["InGameCurrencyService ⬜"]
        A1["호출자: 클라 HTTP"]
        A2["안전장치: 타입 화이트리스트"]
        A3["금액 결정: 클라"]
        A4["멱등: ❌"]
        A5["트랜잭션: 자체 시작"]
    end

    subgraph B["CurrencyLedgerService"]
        B1["호출자: 서버 로직"]
        B2["안전장치: 멱등키"]
        B3["금액 결정: 서버"]
        B4["멱등: ✅ 2단"]
        B5["트랜잭션: 호출자에 합류"]
    end

    R["서버 주도 타입은<br/>클라 신뢰 전제 검증을<br/>통과할 수 없다"]:::reason
    A -.->|"그래서 분리"| R -.-> B

    style A fill:#9ca3af1a,stroke:#9ca3af
    style B fill:#3b82f61f,stroke:#3b82f6,stroke-width:3px
    classDef reason fill:#eab30833,stroke:#eab308
```

`InGameCurrencyService`는 **"earn은 PURCHASE 불가 / spend는 PURCHASE만"**이라는 **클라 신뢰 전제**의
검증을 걸고 있어, 서버 주도 타입(`BET_*`·`*_GOAL`)이 통과할 수 없다.
`CurrencyLedgerService`는 호출자가 서버 로직이라는 전제 아래 타입 제약 대신 **멱등키**로 안전성을 확보한다.

> 🟥 **부채**: `spend`가 아직 `InGameCurrencyService`에 남아 원장 규율 밖에 있다.
> 서버 주도 경로는 전부 원장 서비스로 모였지만 구매만 예외다 → [PRD REQ-R2](./prd.md)

---

## 4. 왜 금액 공식을 별도 클래스로 두는가 🟦

```mermaid
flowchart TD
    P["지급 호출부가 5곳으로 흩어져 있다"]:::fact

    P --> BAD{"매직넘버를<br/>각 호출부에 두면"}
    BAD --> B1["정책 변경 시 어디를<br/>고쳐야 하는지 모른다"]:::bad
    BAD --> B2["'우리 앱은 얼마를 주는가'에<br/>답할 문서가 코드에 없다"]:::bad
    BAD --> B3["Spring 컨텍스트 없이<br/>규칙을 테스트할 수 없다"]:::bad

    P ==> GOOD["CurrencyRewardPolicy<br/>순수 static · 상태 없음<br/>인스턴스화 차단"]:::good
    GOOD --> G1["호출부는 사유와 입력만 넘기고<br/>금액 산정은 위임"]:::good2
    GOOD --> G2["전체 지급 정책이<br/>한 파일에서 읽힌다"]:::good2
    GOOD --> G3["단위 테스트로 규칙 전체 검증"]:::good2

    classDef fact fill:#9ca3af14,stroke:#94a3b8
    classDef bad fill:#ef444433,stroke:#ef4444
    classDef good fill:#3b82f633,stroke:#3b82f6,stroke-width:3px
    classDef good2 fill:#3b82f61f,stroke:#60a5fa
```

### 4.1 클라 미러의 위치와 경계 🟦

```mermaid
flowchart LR
    SRV["서버 CurrencyRewardPolicy<br/><b>지급 정본</b>"]:::srv

    SRV -.->|"수동 동기<br/>🟥 자동화 없음"| CLI["앱 currencyRewards.ts<br/><b>표기 전용</b>"]:::cli
    CLI --> M1["집중 목표 공식 ✅ 미러"]:::ok
    CLI --> M2["스크린타임 목표 공식 ✅ 미러"]:::ok
    CLI --> M3["리그 보너스 공식 ❌ 미러 안 함"]:::no

    M3 --> R["서버가 실지급액을 응답에 싣는다<br/>+ 계산해 두면 서버가 진짜 0을 준 경우<br/>금액을 지어내는 폴백으로 오용되기 쉽다"]:::reason

    classDef srv fill:#3b82f633,stroke:#3b82f6,stroke-width:3px
    classDef cli fill:#3b82f61f,stroke:#60a5fa
    classDef ok fill:#22c55e33,stroke:#22c55e
    classDef no fill:#ef444433,stroke:#ef4444
    classDef reason fill:#eab30833,stroke:#eab308
```

---

## 5. 데이터 왕복 — 경로별 시퀀스

### 5.1 세션 완료 지급 (실시간)

```mermaid
sequenceDiagram
    autonumber
    actor U as 👤 사용자
    participant A as 📱 앱
    participant FS as FocusService
    participant P as RewardPolicy 🟦
    participant L as LedgerService
    participant W as 💾 지갑
    participant T as 📜 원장

    U->>A: 집중 세션 종료
    A->>FS: POST /focus-session

    rect rgba(59, 130, 246, 0.14)
    note over FS,T: 단일 트랜잭션
    FS->>W: 세션 저장 · 통계 반영
    FS->>L: credit(SESSION_COMPLETE, delta초÷10,<br/>focus:{sessionId}:reward)
    L->>T: 멱등키 존재?
    T-->>L: 없음
    L->>W: balance += 금액
    L->>T: INSERT 원장
    L-->>FS: true

    FS->>FS: 집중 목표 false→true 전이?
    FS->>P: focusGoalReward(그날의 goalMinutes)
    P-->>FS: 금액
    FS->>L: credit(FOCUS_GOAL, 금액,<br/>focusGoal:{userId}:{date})
    L->>W: balance += 금액
    L->>T: INSERT 원장
    end

    FS-->>A: 200 · awardedCoins · goalRewardCoins
    A->>A: +N 배지 표시 (잔액은 올리지 않음)
    A->>FS: GET /currency
    FS-->>A: 서버 잔액
    A-->>U: 잔액 칩 ⏳N 갱신
```

### 5.2 스크린타임 목표 지급 (실시간)

```mermaid
sequenceDiagram
    autonumber
    participant N as 📲 네이티브 익스텐션
    participant A as 📱 앱
    participant ST as ScreenTimeService 🟦
    participant P as RewardPolicy 🟦
    participant L as LedgerService
    participant DB as 💾 지갑 + 원장

    note over N: 사용량은 기기에 보존만 —<br/>서버 업로드는 앱 실행 때
    N->>A: 앱 실행 시 사용량 읽기
    A->>ST: 스크린타임 저장

    rect rgba(59, 130, 246, 0.14)
    ST->>ST: 사용량 ≤ 상한? 목표 달성 전이?
    ST->>P: screenTimeGoalReward(limitMinutes)
    P-->>ST: 금액
    ST->>L: credit(SCREEN_TIME_GOAL, 금액,<br/>stGoal:{userId}:{date})
    L->>DB: 멱등 판정 → 잔액 += → 원장 INSERT
    end

    ST-->>A: 저장 완료
    A->>A: 축하 모달 +N (클라 미러 공식으로 표기)
    A->>ST: GET /currency
    ST-->>A: 서버 잔액
```

### 5.3 내기 — 차감(실시간) → 정산(배치)

```mermaid
sequenceDiagram
    autonumber
    actor U as 👤 사용자
    participant A as 📱 앱
    participant BV as GroupBetService ⬜
    participant L as LedgerService
    participant DB as 💾 지갑 + 원장
    participant CR as ⏰ 크론
    participant SS as SettlementService ⬜
    participant BT as Settler ⬜
    participant J as BetJudge ⬜

    rect rgba(148, 163, 184, 0.14)
    note over U,DB: ① 참가 — 즉시 에스크로
    U->>A: 내기 참가 (참가비 N)
    A->>BV: POST 참가
    BV->>DB: 내기 행 FOR UPDATE
    BV->>L: debit(BET_STAKE, N,<br/>bet:{betId}:stake:{userId})
    L->>DB: 잔액 부족? → INSUFFICIENT_CURRENCY
    L->>DB: 잔액 −= N · 원장 INSERT
    BV-->>A: 참가 완료
    A->>BV: GET /currency
    BV-->>A: 차감된 잔액
    end

    rect rgba(245, 158, 11, 0.14)
    note over CR,DB: ② 정산 — 익일 배치 (FOCUS 01:00 · SCREEN_TIME 12:00)
    CR->>SS: settleDueBets(category)
    SS->>SS: bet_date < 기준일 · status=OPEN 스캔
    loop 내기 건별 — 트랜잭션 1개씩
        SS->>BT: settle(betId)
        BT->>DB: FOR UPDATE 잠금
        BT->>J: 달성 판정 (화면 진행률과 같은 소스)
        J-->>BT: 참가자별 진행분
        BT->>BT: 분배 계산 · 불변식 검사
        BT->>DB: CAS status OPEN→SETTLED
        BT->>L: credit(BET_PAYOUT, 몫,<br/>bet:{betId}:payout:{userId})
        L->>DB: 잔액 += · 원장 INSERT
        BT-->>SS: SettleResult(status, applied)
    end
    SS->>SS: 요약 로그 · 실패 집계
    end

    rect rgba(148, 163, 184, 0.14)
    note over A,U: ③ 결과 전달
    SS-->>A: BET_RESULT 푸시
    U->>A: 앱 진입
    A->>BV: GET /currency + 내기 결과
    BV-->>A: 지급된 잔액 · 결과
    end
```

### 5.4 리그 승급 보너스 (주 배치)

```mermaid
sequenceDiagram
    autonumber
    participant CR as ⏰ 월 00:00 KST
    participant LB as LeagueBatchService
    participant US as LeagueUserSettler
    participant P as RewardPolicy 🟦
    participant L as LedgerService
    participant DB as 💾 지갑 + 원장

    CR->>LB: runWeeklyBatch
    LB->>LB: anchor 중복 검사
    LB->>LB: 지난주 집중 합계 커서 페이징 100건
    loop 유저 건별 — 트랜잭션 1개씩
        LB->>US: settle(user)
        US->>US: 임계값 기반 승강 판정
        alt 승급
            US->>P: leaguePromotionReward(newTier)
            P-->>US: 보너스
            US->>L: credit(LEAGUE_TIER_BONUS, 보너스,<br/>league:{weekStart}:{userId})
            L->>DB: 멱등 판정 → 잔액 += → 원장 INSERT
        else 유지 · 강등
            US->>US: 지급 없음
        end
        US->>DB: league_weekly_results INSERT
    end
    note over DB: 앱은 리그 결과 조회 시<br/>promotionBonusCoins 로 실지급액 수령
```

### 5.5 구매 (실시간) — 🟥 원장 규율 밖

```mermaid
sequenceDiagram
    autonumber
    actor U as 👤 사용자
    participant A as 📱 앱 CoinProvider 🟦
    participant ING as InGameCurrencyService ⬜
    participant DB as 💾 지갑 + 원장

    U->>A: 아이템 구매
    A->>A: coins < price? → 즉시 거절

    rect rgba(239, 68, 68, 0.14)
    A->>ING: POST /currency/spend {amount, type: PURCHASE}
    ING->>ING: type != PURCHASE → ILLEGAL_SPEND_REASON
    ING->>DB: 잔액 −= amount
    ING->>DB: 원장 INSERT (멱등키 없음 🟥)
    note over ING,DB: 재시도가 오면 이중 차감된다
    end

    ING-->>A: 204
    A->>A: setCoins(prev - price) · 보유 목록에 추가
    A->>A: 다음 화면 포커스의 refresh가 서버값으로 덮음
    A-->>U: 구매 완료
```

---

## 6. 정산 트리거 / 로직 분리

```mermaid
flowchart TD
    subgraph L1["트리거 계층 — 로직 없음"]
        C1["⏰ 크론 FOCUS 01:00"]:::trig
        C2["⏰ 크론 SCREEN_TIME 12:00"]:::trig
        C3["🔧 수동 API<br/>local/dev/staging + 관리자 키"]:::trig
        C4["🆕 창 종료 트리거<br/>P1에서 추가 예정"]:::future
    end

    SS["SettlementService<br/><b>트랜잭션 없음</b><br/>대상 스캔 + 요약/실패 집계"]:::mid

    ST["Settler<br/><b>@Transactional</b><br/>정산 1건 = 롤백 1단위"]:::leaf

    C1 & C2 & C3 --> SS
    C4 -.-> SS
    SS -->|"건별 호출"| ST

    NOTE1["클래스를 나눈 이유는 기술적 —<br/>자기 호출은 Spring 프록시를 타지 않아<br/>건별 트랜잭션이 성립하지 않는다"]:::note
    NOTE2["중간 계층에 트랜잭션이 없는 것이 핵심 —<br/>여기서 묶으면 한 건의 롤백이 전체를 되돌린다"]:::note
    NOTE3["이 구조가 실시간 전환을 싸게 만든다 —<br/><b>트리거만 추가하면 되고<br/>정산 로직은 손대지 않는다</b>"]:::good

    SS --- NOTE2
    ST --- NOTE1
    C4 --- NOTE3

    classDef trig fill:#9ca3af26,stroke:#9ca3af
    classDef future fill:#3b82f633,stroke:#3b82f6,stroke-dasharray:5 3
    classDef mid fill:#f59e0b33,stroke:#f59e0b,stroke-width:2px
    classDef leaf fill:#22c55e33,stroke:#22c55e,stroke-width:2px
    classDef note fill:#eab30833,stroke:#eab308
    classDef good fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
```

### 6.1 왜 카테고리별로 크론을 나누는가

```mermaid
gantt
    title 정산 크론 타임라인 (KST)
    dateFormat HH:mm
    axisFormat %H:%M

    section 데이터 완결
    집중 통계 완결 (세션 종료시각 귀속)    :milestone, m1, 00:00, 0m
    스크린타임 어제치 보고 유입 (앱 실행)   :active, st, 06:00, 6h

    section 정산 배치
    그레이스 1h                          :g, 00:00, 1h
    FOCUS 정산                           :crit, f, 01:00, 15m
    SCREEN_TIME 정산                     :crit, s, 12:00, 15m

    section ops
    판돈 동결 감지                        :d, 09:00, 15m
```

| 크론 | 시각 | 왜 그 시각인가 |
|---|---|---|
| FOCUS 정산 | 01:00 | 집중 일별 통계는 세션 **종료 시각** 귀속이라 자정에 완결. 자정 넘겨 끝난 세션을 위한 그레이스 1h만 두면 충분 |
| SCREEN_TIME 정산 | 12:00 | 네이티브가 기기에 보존하고 업로드는 앱 실행 때. 어제치 최종 보고가 **다음날 첫 실행**에 올라오므로, 01:00에 정산하면 "미보고 = 미달성" 억울패배가 양산된다 |
| 판돈 동결 감지 | 09:00 | 두 정산이 다 지난 뒤 남은 OPEN을 확인 |

**대상 선정만 카테고리로 갈리고 정산 로직은 하나다.**

---

## 7. 클라 상태 관리 🟦

### 7.1 왜 낙관 가산을 쓰지 않는가

```mermaid
sequenceDiagram
    autonumber
    participant A as 📱 앱
    participant S as 서버

    note over A,S: ❌ 낙관 가산을 쓰면 (현재 구조가 아님)
    A->>S: GET /currency 시작
    A->>S: POST /focus-session (지급 +7)
    A->>A: 화면 잔액 100 → 107 미리 올림

    alt 경우 ① 서버가 지급 전에 잔액을 읽음
        S-->>A: 100 (실제 잔액은 107)
        note over A: 보정하면 7 손실
    else 경우 ② 서버가 지급 후에 잔액을 읽음
        S-->>A: 107
        note over A: 보정하면 정상
    end

    note over A: 앱은 ①/②를 구분할 정보가 없다 —<br/>잔액만 오고 시점 정보가 없기 때문이다.<br/>어느 쪽으로 보정해도 반대편이 틀린다.
```

```mermaid
sequenceDiagram
    autonumber
    participant A as 📱 앱
    participant S as 서버

    note over A,S: ✅ 현재 구조 — 낙관 가산 없음
    A->>S: POST /focus-session
    S-->>A: awardedCoins = 7
    A->>A: +N 배지만 표시 · <b>잔액은 건드리지 않음</b>
    A->>S: GET /currency (화면 포커스)
    S-->>A: 107
    A->>A: coins = 107 · version++

    note over A: 화면 잔액은 항상<br/>"서버가 마지막에 말한 값"<br/>→ 판정할 시점이 사라진다
```

### 7.2 잔액 재조회 — 시퀀스 가드

```mermaid
sequenceDiagram
    autonumber
    participant V1 as 시트 오픈
    participant V2 as 성공 직후
    participant C as CoinProvider 🟦
    participant S as 서버

    V1->>C: refresh()
    C->>C: seq = 1
    C->>S: GET /currency
    V2->>C: refresh()
    C->>C: seq = 2
    C->>S: GET /currency

    S-->>C: 응답 (seq 2) = 93
    C->>C: seq 2 == 최신 → 반영 · return true

    S-->>C: 응답 (seq 1) = 100 〔늦게 도착〕
    C->>C: seq 1 != 최신 → <b>폐기</b> · return false

    note over C: 가드가 없으면 <b>차감 전 잔액 100</b>이<br/>차감 후 93을 덮어써, 화면이 재산을<br/>과대 표시하고 부족 검사를 잘못 통과시킨다
```

| 장치 | 왜 |
|---|---|
| **시퀀스 가드** | `refresh`는 여러 곳에서 겹쳐 불린다(시트 오픈 + 성공 직후 + 인라인 재시도) |
| **무효 호출은 `false`** | 실패가 아니지만 반영되지 않았다. `true`로 치면 뒤이은 호출이 실패했을 때 "동기화됐다"는 **거짓 확정**이 된다 |
| **실패 시 `coinsLoaded=false`** | 조용히 삼키지 않는다 — "지금 쥔 값은 못 믿는다"를 소비자가 알 수 있게 |
| **`throw` 안 함** | 잔액은 화면을 막을 값이 아니다. 호출처가 try/catch를 두지 않아도 되게 |
| **ref + state 이중화** | state는 응답 적용~다음 렌더 사이 한 틱 낡는다. 비동기 콜백은 ref 게터로 읽는다 |

---

## 8. 신뢰 경계

```mermaid
flowchart LR
    subgraph DEVICE["📱 기기 — 신뢰하지 않음"]
        D1["집중 세션 시각<br/>🔶 클라 보고값 누적"]:::soft
        D2["스크린타임 사용량<br/>🔶 클라 보고값"]:::soft
        D3["보유 아이템<br/>🟥 앱 로컬만"]:::gap
        D4["화면 잔액<br/>표시용 사본"]:::soft
    end

    BOUND{{"신뢰 경계"}}:::bound

    subgraph SERVER["🔒 서버 — 정본"]
        S1["목표 설정값"]:::hard
        S2["지급 금액<br/>RewardPolicy"]:::hard
        S3["지급 시점<br/>달성 전이 판정"]:::hard
        S4["잔액"]:::hard
        S5["원장"]:::hard
    end

    DEVICE --> BOUND --> SERVER

    N1["플랫폼 차원 전제 —<br/>리그·스트릭·재화가 공유한다<br/>재화 단독으로 해결할 문제가 아니다"]:::note
    N2["위조 리스크 수용 확정 정책"]:::note
    D1 --- N1
    D2 --- N2

    classDef soft fill:#f59e0b33,stroke:#f59e0b
    classDef hard fill:#22c55e33,stroke:#22c55e,stroke-width:2px
    classDef gap fill:#ef444433,stroke:#ef4444
    classDef bound fill:#64748b4d,stroke:#64748b
    classDef note fill:#eab30833,stroke:#eab308
```

---

## 9. 배치 인프라

구현 방식은 **인메모리 Spring `@Scheduled`** — 별도 배치 서버·MQ 없음.
왜 그런지와 언제 바꾸는지는 [PRD §8.6](./prd.md).

| | 내기 정산 | 리그 승급 |
|---|---|---|
| 크론 | FOCUS 01:00 / SCREEN_TIME 12:00 KST | 월 00:00 KST |
| 트랜잭션 단위 | **내기 1건** | **유저 1명** |
| 실패 격리 | 🟩 건별 | 🟩 유저별 |
| 재실행 안전 | 🟩 멱등키 + 상태 CAS | 🟩 멱등키 + anchor 중복 검사 |
| 미실행 감지 | 🟩 `GroupBetFreezeMonitor` 09:00 | 🟥 없음 |
| 분산 락 | 🟥 없음 | 🟥 없음 |
| 수동 트리거 | 🟩 관리자 키 + 프로파일 게이팅 | 🟩 |

### 9.1 배치 미실행 감지 (내기만)

```mermaid
flowchart LR
    M["⏰ 09:00 FreezeMonitor"]:::ok --> Q{"bet_date ≤ 오늘−2<br/>이면서 status=OPEN<br/>인 내기가 있는가"}
    Q -->|"없음"| OK["info 로그<br/>정상"]:::ok
    Q -->|"있음"| ERR["error 로그<br/>판돈 24h 이상 동결"]:::err
    ERR --> WHY["에스크로된 판돈이 묶여<br/>유저 돈이 사라진 것처럼 보이는데,<br/>배치가 안 돌면 실패 로그조차 없다"]:::note

    classDef ok fill:#22c55e33,stroke:#22c55e
    classDef err fill:#ef444433,stroke:#ef4444,stroke-width:2px
    classDef note fill:#eab30833,stroke:#eab308
```

관리자 푸시·슬랙 연동은 범위 밖 — **로그 고정 포맷으로 알림 규칙을 걸 수 있게 하는 데까지**다.
