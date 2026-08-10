# HLD — 그룹 생애주기 통합 설계

| 항목 | 내용                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------ |
| 상위 | [그룹 PRD](./prd.md) · [그룹 IA](./information-architecture.md)                                  |
| 하위 | [통합 LLD](./low-level-design.md) · [기능별 상세 문서](./README.md)                              |
| 역할 | 01 그룹 획득, 02 내 그룹 탐색, 03 그룹 활동, 04 그룹 운영의 책임과 연결을 한 문서에서 보여 준다. |
| 제외 | 카드 치수, 화면별 컴포넌트, API 요청 body, 세부 오류 코드는 기능별 HLD·LLD를 따른다.             |

---

## 0. 구현 상태 읽기

현재 구현 여부, 남은 작업, 책임 역할과 출시 gate는 [그룹 구현 상태 정본](./shared/implementation-status.md)에서만 관리한다. 이 HLD의 그림은 목표 책임과 연결을 설명하며 구현 완료를 뜻하지 않는다.

---

## 1. 기능 책임과 생애주기 연결

```mermaid
flowchart LR
    Entry["그룹 탭 · 화면 복귀"] --> Resolve["전체 소속 목록 확인"]
    Resolve -->|0개| Acquire["01 그룹 획득<br/>찾기 · 초대 · 생성 · 가입"]
    Resolve -->|1개 이상| Explore["02 내 그룹 탐색<br/>소속·요약·행동 선택"]
    Resolve -->|"실패 · 부분 응답"| Safe["안전한 오류 · 다시 시도"]
    InviteEntry["초대 링크"] --> Acquire
    Acquire --> Membership["서버가 소속 확정"]
    Membership --> Refresh["전체 소속 목록 확인"]
    Refresh -->|"찾기 · 생성"| Explore
    Refresh -->|"초대 대상 포함"| Activity
    Refresh -->|"실패 · 부분 응답"| Safe

    Explore -->|"더 찾기 · 만들기"| Acquire
    Explore -->|집중| Focus["기존 집중 도메인"]
    Explore -->|방 전체| Activity["03 그룹 활동<br/>방 · 멤버 · 공지 · 집중 진입"]
    Activity -.-> Challenge["챌린지<br/>별도 PRD"]
    Activity -->|집중| Focus
    Activity -->|초대 링크 발급·공유| Share["기존 그룹 확장"]
    Share -.->|수신자| Acquire
    Activity -->|설정| Operate["04 그룹 운영<br/>프로필 · 역할 · 멤버 · 권한 · 이탈"]

    Operate -->|소속·역할 변경| Invalidate["관련 목록·상세 무효화"]
    Invalidate --> Refresh
    Focus -->|"탐색에서 시작"| Explore
    Focus -->|"방에서 시작"| Activity
    Activity -->|뒤로| Explore

    Push["그룹 알림"] --> Verify["소속 목록으로 대상 확인"]
    Verify -->|현재 소속| Activity
    Verify -->|비소속| Explore
    Verify -->|"조회 실패 · 사용자 이탈"| Safe
```

- `01`은 소속을 얻는 과정, `02`는 소속 이후의 탐색, `03`은 공동 활동, `04`는 공동 관계의 변경을 소유한다.
- 기능 간 전달값의 신원은 항상 `groupId`다. 화면 index·이름·카드 위치는 전달 계약이 아니다.
- 소속·역할이 바뀌면 관련 화면이 각자 추정하지 않고 서버 목록·상세를 다시 확인한다.
- 초대 가입은 목록에서 대상 소속을 확인한 뒤 해당 방으로 가고, 찾기·생성은 내 그룹 탐색으로 합류한다. 집중이 끝나면 시작한 탐색 또는 방 맥락으로 돌아온다.

---

## 2. 데이터 정본과 개인 상태의 경계

```mermaid
flowchart TB
    subgraph Server["서버 정본"]
        Group["그룹<br/>프로필 · 공개 범위 · 정원"]
        Member["멤버십 · 역할 · 강퇴 · 종료"]
        Content["공지 · 하위 활동 진입"]
        Invite["초대 링크 · 가입 결과"]
    end

    subgraph Device["현재 계정·기기의 보조 상태"]
        Preference["카드 순서 · 내 카드 아이콘"]
        Pending["로그인 뒤 이어갈 초대 맥락"]
    end

    Acquire["01 그룹 획득"] <--> Invite
    Acquire <--> Group
    Explore["02 내 그룹 탐색"] <--> Group
    Explore <--> Member
    Explore <--> Preference
    Activity["03 그룹 활동"] <--> Content
    Activity <--> Member
    Operate["04 그룹 운영"] <--> Group
    Operate <--> Member
    Acquire <--> Pending
```

| 정보                     | 정본                  | 허용되는 로컬 역할                                        |
| ------------------------ | --------------------- | --------------------------------------------------------- |
| 소속·역할·정원·공개 범위 | 서버                  | 마지막 확인 결과를 표시할 수 있으나 새 사실을 만들지 않음 |
| 공지·하위 활동           | 서버                  | 공지 입력 draft만 보조; 하위 기능 상세는 별도 문서        |
| 초대 목적지              | 서버 링크의 `groupId` | 인증 전후에 같은 초대 맥락을 잠시 보관                    |
| 카드 순서·내 카드 아이콘 | 현재 계정·기기        | 표시만 변경, 서버 DTO·권한·다른 사용자 화면에 영향 없음   |

---

## 3. 기능 사이의 성공 계약

```mermaid
sequenceDiagram
    participant U as 사용자
    participant A as 01 그룹 획득
    participant S as 서버
    participant E as 02 내 그룹 탐색
    participant R as 03 그룹 활동
    participant O as 04 그룹 운영

    U->>A: 찾기·초대·만들기
    A->>S: 가입 또는 생성 요청
    S-->>A: 멤버십 성공 결과
    A->>S: 전체 소속 목록 재조회
    S-->>A: 성공한 전체 목록
    alt 초대 대상이 목록에 포함됨
        A->>R: stable groupId 전달
        R-->>U: 대상 그룹 방 표시
    else 찾기 또는 생성
        A->>E: 전체 목록 전달
        E-->>U: 내 그룹과 가능한 행동 표시
    end

    U->>E: 그룹 방 선택
    E->>R: stable groupId 전달
    R->>S: 상세·공지 조회
    S-->>R: 영역별 결과

    U->>R: 설정 열기
    R->>O: 같은 groupId 전달
    O->>S: 역할·멤버십 변경
    S-->>O: 성공 결과
    O->>E: 목록·상세 재확인 요청
```

- 가입·생성 API 성공과 화면 소속 반영은 별도 단계다. 전체 목록 확인 실패를 빈 상태나 중복 요청으로 되돌리지 않는다.
- 모든 가입 mutation은 서버가 그룹의 삭제·`ENDED` 여부를 다시 확인하고 마지막 이탈과 group 행에서 직렬화한다. 이미 활성 멤버의 `ALREADY_MEMBER`는 mutation 없이 기존 방 이동으로 처리한다. 세부 오류·경합 계약은 [01 획득 HLD](./features/01-acquisition/high-level-design.md)가 소유한다.
- 그룹 방은 카드 요약 캐시를 정본으로 받지 않고 자신의 서버 정보를 조회한다.
- 운영 성공 뒤에는 이전 역할·멤버·소속 캐시를 그대로 사용하지 않는다.

---

## 4. 실패 격리와 안전한 복귀

```mermaid
flowchart TD
    Failure["요청 실패 또는 늦은 응답"] --> Scope{"어느 범위의 실패인가?"}
    Scope -->|전체 소속 목록| ListError["그룹 화면 오류<br/>소속·개인 설정 정리 금지"]
    Scope -->|detail 성공 뒤 공지·하위 영역| SectionError["그 영역만 오류 표시<br/>현행은 공용 방 재조회 · 다른 영역 유지"]
    Scope -->|변경 요청| MutationError["서버 값 유지<br/>중복 요청 없이 명시적 재시도"]
    Scope -->|소속 없음 확인| MembershipGone["해당 groupId 화면 종료<br/>남은 내 그룹 또는 빈 상태"]

    Late["늦은 응답"] --> Guard{"계정 · groupId · 날짜 · 화면이<br/>아직 같은가?"}
    Guard -->|예| Apply["원래 영역에만 반영"]
    Guard -->|아니오| Discard["폐기"]
```

- 현재 그룹방은 최초 detail 조회가 실패하면 전체 오류를 보이며 집중 진입도 제공하지 않는다. detail이 성공한 뒤 공지·하위 영역의 실패만 각 영역에서 격리한다.
- 그룹방의 영역별 오류 표시는 격리되어 있지만 현재 `다시 시도`는 공용 방 재조회다. 특정 영역 요청만 다시 보내는 개선 상태는 [공통 구현 상태](./shared/implementation-status.md)의 `GRP-03`이 소유한다.
- 네트워크 실패는 탈퇴·강퇴·그룹 종료의 증거가 아니다.
- `403/404`도 기능별 의미를 확인한 뒤 소속 없음과 단순 권한 변경을 구분한다.
- 불완전한 값은 `0명`이나 빈 공지처럼 정상 데이터로 강하하지 않는다.

---

## 5. 권한과 비가역 행동

```mermaid
flowchart LR
    Intent["변경 의도"] --> Latest["서버의 최신 소속·역할·상태 확인"]
    Latest -->|허용| Commit["서버 트랜잭션으로 확정"]
    Latest -->|거절| Reject["이유 표시 · 화면 재동기화"]
    Commit --> Refresh["관련 기능의 목록·상세 재조회"]

    Commit --> Examples["생성 · 가입 · 공지 변경<br/>위임 · 강퇴 · 나가기"]
```

- 공동 프로필·방장 위임·멤버 강퇴·공지 권한 관리는 OWNER 전용이다.
- 공지 권한을 받은 MEMBER는 공지를 작성·수정·삭제할 수 있으며 서버가 요청 시 다시 검증한다.
- 카드 순서와 내 카드 아이콘 실패는 공동 상태 변경을 취소하지 않는다.

---

## 6. 기능별 상세 정본

| 번호 | 기능         | 시작점                                           | 상세 설계                                                                                                    |
| ---- | ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 01   | 그룹 획득    | [착수 카드](./features/01-acquisition/README.md) | [HLD](./features/01-acquisition/high-level-design.md) · [LLD](./features/01-acquisition/low-level-design.md) |
| 02   | 내 그룹 탐색 | [착수 카드](./features/02-my-groups/README.md)   | [HLD](./features/02-my-groups/high-level-design.md) · [LLD](./features/02-my-groups/low-level-design.md)     |
| 03   | 그룹 활동    | [착수 카드](./features/03-activity/README.md)    | [HLD](./features/03-activity/high-level-design.md) · [LLD](./features/03-activity/low-level-design.md)       |
| 04   | 그룹 운영    | [착수 카드](./features/04-operation/README.md)   | [HLD](./features/04-operation/high-level-design.md) · [LLD](./features/04-operation/low-level-design.md)     |

분석 이벤트의 의미상 소유 기능은 `01=찾기·초대·생성·가입`, `02=그룹 화면·카드·가이드·개인 아이콘`, `03=방·집중·공지`, `04=역할·멤버십 변경`이다. 공통 이벤트명·속성·발행 주체·금지 정보는 [그룹 공통 분석 계약](./shared/analytics.md), 챌린지 계측은 [챌린지 문서 세트](../challenge/README.md)가 각각 소유한다.

통합 HLD는 기능 사이의 연결 정본이고 기능 HLD는 내부 책임·API 경계를 보완한다. 문서 종류별 충돌은 [문서 지도](./README.md#2-정본은-문서-종류별로-결정한다)의 범위 규칙으로 해결한다.
