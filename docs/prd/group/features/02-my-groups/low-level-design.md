# Feature LLD — 내 그룹 카드 덱

| 항목      | 내용                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 시작      | [구현 착수 카드](./README.md)                                                                                                    |
| 상위 정본 | [그룹 PRD](../../prd.md) · [Feature PRD](./prd.md) · [Feature IA](./information-architecture.md) · [HLD](./high-level-design.md) |
| 역할      | 카드 덱의 상태 전이·실패 복구·검증 기준을 그림으로 확정한다.                                                                     |
| 문서 범위 | 구현 정책과 예외만 다룬다. 코드·타입·컴포넌트 목록·시각 수치는 반복하지 않는다.                                                  |
| 구현 상태 | [공통 상태 정본](../../shared/implementation-status.md)의 `GRP-02`를 따른다.                                                     |

PRD가 제품 결정을, IA가 화면과 정보 구조를, HLD가 시스템 책임을 정한다. 이 문서는 그 결정을 바꾸지 않고 **어떤 상태 전이만 허용할지**를 정한다.

---

## 1. 그룹 카드의 정체성과 화면 복구

```mermaid
flowchart TB
    Enter["그룹 화면 진입"] --> Full{"서버의 전체 그룹 목록을<br/>성공적으로 받았는가?"}
    Full -->|아니오 · 부분 응답| Existing["현행 게스트 · 불러오는 중 · 오류 화면"]
    Existing --> Safe["멤버십 추정 금지<br/>개인 설정 정리·삭제 금지"]

    Full -->|예| Count{"소속 그룹 수"}
    Count -->|0개| Empty["현행 빈 상태<br/>그룹 만들기 · 찾기"]
    Count -->|1개 이상| Compose["서버 소속 그룹과<br/>현재 계정의 기기 설정을 합성"]
    Compose --> Deck["stable groupId 기반 카드 덱<br/>끝에는 그룹 찾기 카드"]

    Empty --> Acquire["가입 또는 생성 성공"]
    Acquire --> Full

    Deck --> Front["그룹 카드 앞면"]
    Front -->|본문 탭| Back["같은 groupId의 뒷면 요약"]
    Back -->|이 그룹으로 집중| Focus["기존 집중 흐름"]
    Back -->|방 전체 보기| Room["기존 전체 그룹 방"]

    Room --> Return["뒤로 가기<br/>소속 변경 가능성이 있으면 목록 재조회"]
    Return --> Exists{"출발 groupId가<br/>아직 소속 목록에 있는가?"}
    Exists -->|예| Restore["같은 그룹 · 뒷면 · 위치 · 초점 복원"]
    Exists -->|아니오 · 다른 그룹 있음| Fallback["저장한 출발 index에 남은 카드<br/>범위를 넘으면 마지막 카드 · 앞면"]
    Exists -->|아니오 · 그룹 없음| Empty
```

- 그룹의 신원·캐시·뒤집힘·방 복귀는 모두 `groupId`로 판단한다. index는 화면 위치일 뿐이다.
- 끝의 그룹 찾기 카드는 서버 그룹, 저장 순서, 순서 변경 대상이 아니다. 다만 전체 페이지 수와 현재 페이지 표시에는 `그룹 수 + 1`로 포함한다.
- 실패하거나 일부만 받은 목록은 탈퇴·삭제의 증거로 쓰지 않는다.
- 가입·생성 직후에도 전체 목록 재조회가 성공해야 카드 덱으로 전환한다.
- 방 진입 시 저장한 출발 index에 현재 목록의 카드가 있으면 그 카드를, index가 범위를 넘으면 마지막 카드를 앞면으로 연다. 남은 그룹이 없으면 빈 상태로 간다.

---

## 2. 카드 순서·아이콘 저장과 계정 경계

```mermaid
flowchart TB
    Server["서버가 확인한 현재 소속"] --> Compose["현재 계정의 기기 설정과 합성"]
    Local["카드 순서 · 내 카드 아이콘"] --> Compose
    Compose --> UI["현재 카드 덱"]

    UI --> Intent["사용자가 순서 또는 아이콘 변경"]
    Intent --> Immediate["화면에 즉시 반영"]
    Immediate --> Save{"기기 저장 결과"}
    Save -->|성공| Keep["최신 선택 유지"]
    Save -->|실패| Retry["화면은 되돌리지 않음<br/>오류 표시 · 최신 선택만 재시도"]

    Switch["로그아웃 · 계정 전환 · 늦은 작업 완료"] --> Guard{"원래 계정의 작업인가?"}
    Guard -->|예| Original["원래 계정 영역에만 반영"]
    Guard -->|아니오| Discard["현재 화면과 오류 상태 변경 금지"]
```

- 순서와 아이콘은 **현재 계정이 현재 기기에서 보는 방식**일 뿐이며 서버 속성이 아니다.
- 오래된 값을 정리하는 작업은 전체 그룹 목록을 성공적으로 받은 경우에만 한다.
- 순서와 아이콘 저장은 각각 순서대로 처리하며, 저장 직전에 최신 값을 합성해 마지막 선택이 이긴다.
- 늦은 과거 작업은 다른 계정의 화면·오류·이벤트를 바꾸지 못한다.
- 생성 화면의 아이콘은 서버가 생성에 성공해 `groupId`가 생긴 뒤에만 저장한다.

| 저장 목적      | key                         | 최소 shape·수명                                                       |
| -------------- | --------------------------- | --------------------------------------------------------------------- |
| 카드 순서      | `gromo:groups:cardOrder:v1` | `{ [userId]: groupId[] }`; 성공한 전체 목록에서만 reconcile           |
| 내 카드 아이콘 | `gromo:groups:cardEmoji:v1` | `{ [userId]: { [groupId]: allowlistedEmoji } }`; 미설정 fallback `🎯` |
| 첫 안내 완료   | `gromo:guide:groupDeck:v1`  | 기기 전역 값 `1`; 사용자 완료 뒤 best-effort 저장                     |

순서와 아이콘은 서로 다른 key별 queue에서 read-modify-write를 직렬화한다. 저장 실패는 서버 성공을 취소하지 않고 현재 session UI를 rollback하지 않는다.

---

## 3. 한 번의 입력은 한 가지 결과만 만든다

```mermaid
flowchart TD
    Input["사용자 입력"] --> Guide{"첫 안내가 진행 중인가?"}
    Guide -->|예| GuideOnly["안내의 다음 · 시작만 처리<br/>일반 카드 입력 차단"]
    Guide -->|아니오| Surface{"입력한 위치"}

    Surface -->|뒷면 행동 버튼| CTA{"사용 가능하고 처리 중이 아닌가?"}
    CTA -->|예| Action["집중 · 전체 방 · 설정 중<br/>선택한 행동 하나"]
    CTA -->|아니오| Noop["상태 변화 없음<br/>사용자 행동 이벤트 없음"]

    Surface -->|순서 변경 손잡이| Drag{"실제 위치가 바뀌었는가?"}
    Drag -->|예| Reorder["순서 변경 한 번 확정"]
    Drag -->|아니오 · 취소| Noop

    Surface -->|수평 넘김| Page{"활성 페이지가 바뀌었는가?"}
    Page -->|예| Normalize["새 페이지 표시<br/>이전 뒷면은 앞면으로 정리"]
    Page -->|아니오| Noop

    Surface -->|카드 본문 탭| Flip["같은 groupId의 앞면 ↔ 뒷면 전환"]
    Surface -->|끝의 찾기 카드| Find["그룹 찾기 열기"]
```

- 순서 변경 중에는 카드 넘김과 뒤집기를 시작하지 않는다.
- 수평 넘김이 시작되면 본문 탭은 취소한다.
- 접근성의 `앞으로 이동`·`뒤로 이동`도 같은 순서 변경 결과로 합류한다.
- 안내의 자동 뒤집기, 다시 그리기, 애니메이션 완료, 취소 입력은 사용자 행동으로 기록하지 않는다.

---

## 4. 카드 뒷면 데이터와 늦은 응답

```mermaid
flowchart TB
    Open["카드의 첫 뒷면 열기"] --> Parallel["준비됐거나 진행 중인 조회는 재사용하고<br/>필요한 정보만 한 번씩 함께 준비"]
    Parallel --> Group["그룹별 정보<br/>상세 · 공지 · 챌린지"]
    Parallel --> Focus["화면 공유 정보<br/>현재 집중 상태"]

    Group --> State["영역별 상태<br/>불러오는 중 · 표시 가능 · 오류"]
    Focus --> State
    State --> Valid{"응답의 계정 · KST 날짜 · groupId가<br/>아직 유효한가?"}
    Valid -->|예| Correct["해당 카드와 영역에만 반영"]
    Valid -->|아니오| Discard["늦은 응답 폐기<br/>다른 카드에 표시 금지"]

    State -->|한 영역 실패| Partial["그 영역만 다시 시도<br/>다른 정보와 가능한 행동 유지"]
```

- 새 카드 요약 API를 만들지 않고 기존 상세·공지·챌린지·현재 집중 상태를 조합한다.
- 다시 열린 뒷면은 준비된 결과와 진행 중인 조회를 재사용하며 같은 요청을 중복 시작하지 않는다.
- 각 영역은 독립적으로 `불러오는 중 · 표시 가능 · 오류` 상태를 가진다. 실패한 영역만 다시 시도한다.
- 한 영역의 실패는 다른 영역과 `이 그룹으로 집중`·`방 전체 보기`를 막지 않는다. 단, 소속이 사라지면 행동을 중단한다.
- 늦은 응답은 원래 `groupId`에만 반영하며, 그 그룹이 더 이상 유효하지 않으면 버린다.
- 전체 그룹 방은 자신의 기존 정보를 다시 조회한다. 카드의 임시 조합 결과를 방의 정본으로 넘기지 않는다.

---

## 5. 현재 집중 인원은 완전한 정보에서만 계산한다

```mermaid
stateDiagram-v2
    state "대기" as Idle
    state "조회 중" as Loading
    state "계산 가능" as Ready
    state "요청 실패" as Unavailable
    state "범위 불확실" as CoverageUnknown

    [*] --> Idle
    Idle --> Loading: 현재 계정·KST 날짜 조회
    Loading --> Ready: raw 요청 성공 AND 원본 응답 100행 미만
    Loading --> Unavailable: 요청 실패
    Loading --> CoverageUnknown: 원본 길이 100

    Ready: isFocusing=true인 그룹원만 계산
    Ready: 확인된 0명 또는 N명 표시 가능
    Unavailable: 해당 영역 오류 · 다시 시도
    Unavailable: 0명 표시 금지
    CoverageUnknown: 집중 인원 미산출
    CoverageUnknown: 0명 표시 금지

    Ready --> Loading: 새로고침 · KST 날짜 변경
    Unavailable --> Loading: 다시 시도
    CoverageUnknown --> Loading: 관측 복구 · 계약 전환
```

- 운영 `eligible_user_count < 100`은 출시 전제이고 런타임 앱에는 없다. 성공한 원본 응답 길이 `< 100`일 때만 응답에 없는 멤버를 `집중하지 않음`으로 본다.
- 현재 집중 상태는 한 refresh cycle에서 얻은 `현재 계정 + todayStrKst()` 기준으로 화면에서 공유하고, 동시에 같은 요청을 여러 번 보내지 않는다. 요청 인자와 cache key에 기기 로컬 날짜를 섞지 않는다.
- 운영 수 90~99명에서는 대체 계약의 담당자·티켓·배포일을 확정한다. 운영 수 unknown 또는 100 이상이면 출시를 차단하고 대체 계약을 먼저 배포한다.
- 런타임 raw 응답 100행·loading·error는 미산출이며 0명으로 표시하지 않는다.

---

## 6. 첫 카드 덱 안내

```mermaid
flowchart TD
    Eligible{"인증됨 · 성공한 전체 목록 1개 이상<br/>로컬 설정 합성·덱·기준점 완료<br/>화면 전환·팝업·시트·다른 안내 없음?"}
    Eligible -->|아니오| Deck["카드 덱을 그대로 사용<br/>조건이 갖춰지면 다시 판정"]
    Eligible -->|예| Stored{"이 기기에서 v1 안내를<br/>완료했는가?"}
    Stored -->|예| Deck
    Stored -->|아니오 · 읽기 실패| Guide["1~3단계 · 다음"]

    Guide --> Prepare["3→4단계에서 시스템이 뒷면 준비<br/>필요한 정보 조회를 각 1회 시작"]
    Prepare --> NoEvent["사용자 뒤집기·페이지 이동 이벤트 0건<br/>응답 완료를 기다리지 않음"]
    NoEvent --> Step4["4단계 · 시작"]
    Step4 --> Complete["안내 닫기 · 뒷면과 초점 유지<br/>완료 이벤트 현재 세션 1회"]
    Complete --> Persist["기기 완료 기록 저장 시도"]
    Persist -->|성공| Deck
    Persist -->|실패| WriteFail["운영 오류만 기록<br/>현재 사용자의 완료는 취소하지 않음"]
    WriteFail --> Deck

    Guide -->|화면 이탈 · 계정/소속 변경 · 다른 팝업·시트·안내 등장| Interrupted["미완료<br/>완료 이벤트·저장 없음"]
    Prepare -->|중단| Interrupted
    Step4 -->|화면 이탈 · 계정/소속 변경 · 다른 팝업·시트·안내 등장| Interrupted
    Interrupted --> Deck

    Layout["회전 · 기준점 측정 실패"] -.-> Fallback["안내를 끝내지 않고 전체 어둡게 표시<br/>다음 단계에서 다시 측정"]
```

- 완료 기록은 기기 전체 키 `gromo:guide:groupDeck:v1`을 사용한다.
- 1~3단계 행동은 `다음`, 마지막 행동만 `시작`이다.
- 완료 기록 읽기에 실패해도 현재 화면 세션에서는 안내를 한 번만 시도한다.
- 4단계는 각 요약 영역의 `불러오는 중 · 표시 가능 · 오류`를 그대로 보여 준다.
- 완료 이벤트는 마지막 `시작`으로 안내가 닫힌 직후 기록하고, 기기 저장은 그 다음에 시도한다.
- 저장 실패는 현재 foreground에서 안내를 다시 띄우지 않지만, 다음 앱 실행에서는 다시 노출될 수 있다.

---

## 7. 카드 기능의 계측 상태

이벤트 이름·속성·F1 앱 진입·F3 획득 퍼널·결과 귀속 window는 [그룹 공통 분석 계약](../../shared/analytics.md)이 정본이다. LLD는 카드 기능의 상태 전이와 발행 금지만 고정한다.

```mermaid
flowchart LR
    Deck["덱 실제 노출"] --> User["사용자 back flip"]
    Deck --> Guide["안내 완료"]
    User --> Ready["뒷면 사용 가능"]
    Guide --> Ready
    Ready --> Intent["CTA 의도 수락"]
    Intent --> Room["방 성공 결과"]
    Intent --> Focus["집중 시작 성공 결과"]

    Program["안내 자동 back · scroll"] -.->|"사용자 flip · page 이벤트 0건"| Ready
    Noop["rerender · resize · 취소 · no-op"] -.->|"사용자 이벤트 0건"| Intent
```

- guide와 user flip이 같은 session에 모두 있으면 뒷면 사용 가능 단계는 한 번으로 dedupe한다.
- `back_source=guide`는 사용자가 face를 다시 바꾸기 전까지만 유지한다.
- 카드 CTA의 context는 Room·Focus 성공 결과까지 보존하며 다른 카드의 늦은 결과에 재사용하지 않는다.
- 그룹명·소개·아이콘 glyph·asset·로컬 순서·raw `userId`를 payload에 넣지 않는다.

---

## 8. 구현·출시 검증

```mermaid
flowchart LR
    Unit["단위 검증<br/>상태 계산 · 합성 · 1회 처리"] --> Integration["통합 검증<br/>계정 전환 · 늦은 응답 · 부분 실패"]
    Integration --> E2E["사용자 흐름 검증<br/>뒤집기 · 방 복귀 · 안내 · 접근성"]
    E2E --> Analytics["계측 검증<br/>순서 · 중복 · 금지 정보"]
    Analytics --> Gate{"필수 실패가 0건인가?"}
    Gate -->|예| Release["제한 출시 가능"]
    Gate -->|아니오| Stop["출시 중단 · 원인 수정"]
```

필수 출시 게이트는 네 가지다.

1. **정체성·복귀:** 재정렬·목록 갱신·방 왕복 뒤에도 같은 `groupId`를 가리키며, 사라진 카드는 복원하지 않는다.
2. **개인화·늦은 응답:** 빠른 변경과 계정 전환에서도 최신 의도와 계정 영역을 보존하고, 과거 응답을 다른 카드에 표시하지 않는다.
3. **데이터 신뢰:** 부분 실패는 해당 영역에만 남고, 집중 상태의 불명·실패·100 이상을 `0명`으로 표시하지 않는다.
4. **안내·접근성·계측:** 안내의 읽기·중단·저장 실패와 자동 전환을 각각 검증한다. 자동 전환의 사용자 이벤트는 0건이고 완료 이벤트는 저장 성공과 무관하게 1건이다. 그룹명은 모든 위치에서 1줄 말줄임, 접근성 이름은 원문 전체이며, DebugView의 노출 → 의도 → 결과 순서·중복·금지 정보를 확인한다.

## 9. 확정된 구현 결정

### 9.1 출발 그룹이 사라진 복귀

방 진입 때 `{ groupId, sourceIndex, face }`를 저장한다. 전체 목록 재확인 뒤 `groupId`가 없으면 새 목록의 `min(sourceIndex, groups.length - 1)` 카드를 앞면으로 연다. 즉 같은 시각 slot에 들어온 다음 카드를 우선하고, 출발이 마지막이었다면 남은 마지막 카드로 간다. 목록이 비면 기존 빈 상태로 간다.

### 9.2 안내 시작의 안정 신호와 대기 수명

안내 queue에는 다음 조건이 모두 참일 때만 등록한다: 인증 사용자, 성공한 전체 groups 1개 이상, 순서·아이콘 hydration 완료, active 카드와 필수 anchor layout 완료, navigation transition idle, blocking modal·sheet·다른 guide 없음.

queue 대기는 카드 사용을 차단하지 않으며 고정 시간 timeout을 두지 않는다. slot을 받기 전에 screen blur·background·unmount·계정/멤버십 변경이 발생하면 현재 요청을 취소하고 다음 focus에서 다시 판정한다. 안내 시작 뒤 anchor가 사라지거나 폭이 바뀌면 중단하지 않고 전체 dim fallback으로 계속하며 다음 단계에서 재측정한다.
