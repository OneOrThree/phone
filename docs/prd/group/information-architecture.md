# IA — 그룹 전체 경험

| 항목 | 내용                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 상위 | [그룹 생애주기 PRD](./prd.md)                                                                            |
| 하위 | [통합 HLD](./high-level-design.md) · [통합 LLD](./low-level-design.md) · [기능별 상세 지도](./README.md) |
| 역할 | 그룹의 정보 관계, 화면 위치, 역할별 접근, 이동과 복귀 원칙을 정의한다.                                   |
| 제외 | API·캐시 키·이벤트 속성·제스처 수치·컴포넌트 구조는 기능별 HLD·LLD에서 다룬다.                           |

이 문서는 전체 화면·정보 관계의 정본이다. 카드 내부처럼 한 기능에 한정된 정보 위계는 기능 IA가 보완하고, 책임·데이터·구현 방식은 HLD·LLD가 결정한다. 문서 종류별 충돌 규칙은 [문서 지도](./README.md#2-정본은-문서-종류별로-결정한다)를 따른다.

---

## 1. 그룹을 이루는 정보

```mermaid
flowchart LR
    User["사용자"] --> Membership["소속 관계"]
    Membership --> Group["그룹<br/>이름 · 소개 · 공개 범위 · 정원"]
    Membership --> Role["역할<br/>방장 또는 멤버"]
    Group --> People["멤버"]
    Group --> Activity["공동 활동<br/>집중 · 공지 · 챌린지 진입"]
    User --> Preference["개인 기기 설정<br/>카드 순서 · 내 카드 아이콘"]

    subgraph Server["서버의 사실"]
        Membership
        Group
        Role
        People
        Activity
    end

    subgraph Device["현재 계정·기기의 표현"]
        Preference
    end
```

- 서버는 어느 그룹에 속하는지, 어떤 권한이 있는지, 방에서 무슨 일이 일어났는지 결정한다.
- 개인 기기 설정은 같은 서버 그룹을 나에게 어떻게 배열·표시할지만 바꾼다.
- `groupId`가 그룹의 신원이다. 이름과 카드 위치는 이동·복귀·권한의 기준이 아니다.

---

## 2. 전체 화면 지도

```mermaid
flowchart TD
    Entry["그룹 탭 · 초대 링크 · 푸시 · 화면 복귀"] --> Source{"진입 경로"}
    Source -->|그룹 탭 · 화면 복귀| Auth{"인증과 필요한 정보가<br/>확인되었는가?"}
    Auth -->|아니오| Safe["로그인 · 불러오는 중 · 오류<br/>소속을 추정하지 않음"]
    Auth -->|예| Count{"소속 그룹이 있는가?"}

    Count -->|없음| Empty["그룹 빈 상태"]
    Empty --> Find["그룹 찾기"]
    Empty --> Create["그룹 만들기"]
    Source -->|초대 링크| Invite["초대 미리보기"]
    Source -->|그룹 알림| Push{"인증 후 전체 소속 목록에<br/>대상 groupId가 있는가?"}
    Push -->|예| Room
    Push -->|비소속| GroupFallback["내 그룹 탐색 또는 빈 상태"]
    Push -->|목록 실패| Safe
    Source -.->|챌린지 알림| ChallengePolicy["별도 챌린지 IA"]

    Find --> Join["서버 가입 성공"]
    Invite --> Join
    Create --> Created["서버 생성·방장 소속 성공"]
    Join --> Refresh["성공한 전체 소속 목록 확인"]
    Created --> Refresh
    Refresh -->|"찾기 · 생성"| MyGroups
    Refresh -->|"초대 대상 groupId 포함"| Room
    Refresh -->|"실패 · 부분 응답"| Safe

    Count -->|1개 이상| MyGroups["내 그룹 탐색"]
    MyGroups --> Summary["선택한 그룹의 요약"]
    Summary --> Focus["그룹 맥락으로 집중"]
    Summary --> Room["그룹 방 전체"]

    Room --> Notice["공지"]
    Room --> Challenge["챌린지<br/>별도 IA"]
    Room --> Share["초대 링크 발급·공유"]
    Share -.->|수신자| Invite
    Room --> Settings["그룹 설정"]
    Settings --> Role{"현재 역할"}
    Role -->|방장만| Profile["그룹 프로필"]
    Role -->|방장만| Members["방장 위임 · 멤버 · 공지 권한"]
    Role -->|방장·멤버| Personal["그룹 나가기 · 내 카드 아이콘 F02-P1 계획"]
```

- 소속 그룹이 1개여도 기본 진입은 `내 그룹 탐색`이다. 전체 그룹 방은 사용자가 선택한 뒤 열린다.
- 가입·생성의 서버 성공 뒤에는 먼저 성공한 전체 소속 목록을 확인한다. 그 다음 찾기·생성은 내 그룹 탐색으로, 초대는 대상 `groupId`가 목록에 있을 때만 해당 방으로 전환한다.
- 초대 링크는 로그인 전에도 보관될 수 있지만, 인증과 미리보기를 거쳐 가입 결과를 확정한다.

---

## 3. 획득과 운영의 경계

```mermaid
flowchart LR
    Start["그룹을 얻는 방법"] --> Find["찾기<br/>기본 목록 또는 선택 검색"]
    Start --> Invite["초대<br/>링크와 미리보기"]
    Start --> Create["만들기<br/>그룹 정보와 공개 범위"]

    Find --> Join["찾기 가입 확정"]
    Invite --> InviteJoin["초대 가입 확정"]
    Create --> Created["생성·방장 소속 확정"]
    Join --> Refresh["성공한 전체 소속 목록 확인"]
    InviteJoin --> Refresh
    Created --> Refresh
    Refresh -->|찾기·생성| Explore["내 그룹 탐색"]
    Refresh -->|초대 대상 groupId 확인| Room["그룹 방"]

    Explore --> Room
    Room --> Share["초대 링크 발급·공유"]
    Share -.->|수신자| Invite
    Room --> Settings["그룹 설정"]
    Settings --> Owner{"현재 역할"}
    Owner -->|방장| Manage["공동 프로필 · 위임<br/>멤버 · 공지 권한"]
    Owner -->|멤버| Personal["개인 카드 설정 · 나가기"]
    Manage --> Personal
```

- 찾기·초대·만들기는 같은 획득 목적을 가지지만 진입 맥락과 실패 이유를 섞지 않는다.
- 방장은 공동 프로필·역할·멤버·공지 권한을 관리한다. 공지 권한을 받은 멤버는 공지를 작성·수정·삭제할 수 있다. 내 카드 아이콘은 역할과 무관한 개인 설정이다.
- 그룹 삭제 화면은 제공하지 않는다. 마지막 멤버가 정상적으로 나가면 서버가 그룹을 종료한다.

---

## 4. 소속 생애주기

```mermaid
stateDiagram-v2
    state "소속 없음" as None
    state "가입 검토" as Review
    state "생성 중" as Creating
    state "성공한 전체 소속 목록 확인" as Refresh
    state "소속 목록 오류" as RefreshError
    state "현재 그룹 소속 중" as Active
    state "다른 내 그룹 탐색" as OtherGroups
    state "방 사용" as Room
    state "나가기 확인" as Leaving
    state "방장 위임 필요" as Transfer

    [*] --> None
    None --> Review: 찾기 또는 초대
    Review --> Refresh: 서버 가입 성공
    Review --> None: 취소 또는 실패
    None --> Creating: 만들기
    Creating --> Refresh: 서버 생성 성공
    Creating --> None: 취소 또는 실패
    Refresh --> Active: 대상 groupId가 목록에 확인됨
    Refresh --> RefreshError: 조회 실패 또는 부분 응답
    RefreshError --> Refresh: 다시 시도

    Active --> Room: 그룹 방 열기
    Room --> Active: 뒤로 가기
    Active --> Leaving: 그룹 나가기
    Leaving --> Active: 취소 또는 실패
    Leaving --> None: 마지막 소속에서 나가기 성공
    Leaving --> OtherGroups: 다른 그룹이 남은 채 나가기 성공
    Leaving --> Transfer: 방장 위임 필요
    Transfer --> Leaving: 위임 완료
```

- 소속은 로컬 카드 상태가 아니라 서버 관계다. 가입·나가기·강퇴 성공 뒤에는 전체 소속 목록을 확인한 뒤에만 목적지를 정한다.
- 강퇴된 사용자는 일반적인 재가입 경로로 복원하지 않는다.
- 다른 멤버가 있는 방장은 먼저 위임한 뒤 나간다. 마지막 멤버의 정상 이탈은 그룹 종료로 이어진다.

---

## 5. 복귀·실패·중첩 원칙

```mermaid
flowchart TD
    Action["사용자 행동 · 외부 링크 · 화면 복귀"] --> Target{"대상 groupId가<br/>현재도 유효한가?"}
    Target -->|예| Keep["같은 그룹 맥락으로 이동·복귀"]
    Target -->|아니오| Fallback["남은 내 그룹 또는 빈 상태<br/>없는 그룹 복원 금지"]

    Action --> Data{"필요한 데이터가<br/>완전한가?"}
    Data -->|예| Show["확인된 정보 표시"]
    Data -->|일부 실패| Partial["성공 영역 유지<br/>실패 영역만 오류·재시도"]
    Data -->|목록 실패| NoGuess["멤버십·권한·개인 설정 정리 금지"]
    Data -->|값 불명| Unknown["0·없음으로 추정하지 않음"]

    Action --> Overlay{"안내·시트·화면 전환이<br/>겹치는가?"}
    Overlay -->|예| Queue["하나만 표시하고 나머지는 대기"]
```

- 방·설정에서 돌아올 때 index가 아니라 `groupId`로 맥락을 복원한다.
- 서버 목록에서 그룹이 사라졌을 때만 유효한 다른 그룹 또는 빈 상태로 이동한다.
- 일부 데이터 실패가 다른 정보와 안전한 행동까지 숨기게 만들지 않는다.
- 안내·초대 미리보기·생성 완료 시트·화면 전환은 동시에 사용자 입력을 점유하지 않는다.

---

## 6. 화면별 정보 책임

| 화면         | 사용자가 답하는 질문             | 포함                                                             | 포함하지 않음                                         |
| ------------ | -------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| 그룹 빈 상태 | 어떻게 그룹을 얻을까?            | 찾기·만들기, 외부 초대 진입                                      | 존재하지 않는 추천·가짜 활동                          |
| 찾기·초대    | 이 그룹에 들어갈까?              | 공개 정보·정원·가입 결과                                         | 멤버 전용 공지·하위 기능                              |
| 만들기       | 어떤 그룹을 만들까?              | 이름·소개·정원·공개 범위                                         | 하위 기능 동시 생성                                   |
| 내 그룹 탐색 | 내 그룹 중 어디서 무엇을 할까?   | 소속 그룹 식별·요약·집중/방 진입                                 | 그룹 방 전체 기능의 복제                              |
| 그룹 방      | 이 그룹에서 지금 무슨 일이 있나? | 멤버·집중·공지·하위 기능 진입·초대 공유                          | 다른 그룹의 상태                                      |
| 공지         | 무엇을 모두에게 알려야 하나?     | 전체 멤버 읽기, 방장·공지 권한 멤버의 쓰기                       | 화면 노출만으로 쓰기 권한 확정                        |
| 그룹 설정    | 내가 무엇을 바꿀 수 있나?        | 나가기, `F02-P1` 개인 설정, 방장 전용 프로필·위임·멤버·공지 권한 | MEMBER에게 방장 전용 화면 노출, 낡은 역할로 권한 확정 |

---

## 7. 상세 문서 연결

| 정보 범위                                | 상세 문서                                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 찾기·초대·생성·가입                      | [착수 카드](./features/01-acquisition/README.md) · [그룹 획득 HLD](./features/01-acquisition/high-level-design.md) · [LLD](./features/01-acquisition/low-level-design.md)                                                          |
| 카드 앞·뒤, 캐러셀, 순서·아이콘, 첫 안내 | [착수 카드](./features/02-my-groups/README.md) · [내 그룹 탐색 IA](./features/02-my-groups/information-architecture.md) · [HLD](./features/02-my-groups/high-level-design.md) · [LLD](./features/02-my-groups/low-level-design.md) |
| 그룹 방, 집중, 공지                      | [착수 카드](./features/03-activity/README.md) · [그룹 활동 HLD](./features/03-activity/high-level-design.md) · [LLD](./features/03-activity/low-level-design.md)                                                                   |
| 챌린지                                   | [PRD](../challenge/prd.md) · [IA](../challenge/information-architecture.md) · [HLD](../challenge/high-level-design.md) · [LLD](../challenge/low-level-design.md)                                                                   |
| 프로필, 역할, 멤버, 권한, 이탈           | [착수 카드](./features/04-operation/README.md) · [그룹 운영 HLD](./features/04-operation/high-level-design.md) · [LLD](./features/04-operation/low-level-design.md)                                                                |
