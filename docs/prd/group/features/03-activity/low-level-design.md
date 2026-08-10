# LLD — 그룹 활동

| 항목      | 내용                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| 시작      | [구현 착수 카드](./README.md)                                                                                     |
| 상위 정본 | [그룹 활동 HLD](./high-level-design.md) · [그룹 PRD](../../prd.md) · [그룹 IA](../../information-architecture.md) |
| 범위      | 그룹방 핵심 조회, 늦은 응답 격리, 공지 변경, 집중 진입·복귀                                                       |
| 구현 상태 | [공통 상태 정본](../../shared/implementation-status.md)의 `GRP-03`을 따른다.                                      |
| 별도 문서 | 챌린지의 상세 실행 계약과 테스트는 [챌린지 LLD](../../../challenge/low-level-design.md)로 이관                    |

## 1. 방 상태와 늦은 응답

```mermaid
stateDiagram-v2
    [*] --> 불러오는중
    불러오는중 --> 표시가능: 상세 성공
    불러오는중 --> 소속없음: MEMBER_ONLY · 활성 인증 뒤 미소속
    불러오는중 --> 인증확인: NOT_FOUND
    인증확인 --> 세션복구: 비활성 · 탈퇴 계정
    인증확인 --> 소속범위확인: 인증 유효
    소속범위확인 --> 소속없음: 최신 목록·scope가 그룹 부재 · 미소속 확인
    소속범위확인 --> 표시가능: 최신 detail 성공
    소속범위확인 --> 전체오류: 의미 불명 · 재확인 실패 · 기존 detail 없음
    소속범위확인 --> 안전오류: 의미 불명 · 재확인 실패 · 기존 detail 있음
    안전오류 --> 불러오는중: 명시 재시도
    불러오는중 --> 전체오류: 그 밖의 상세 실패 · 기존 detail 없음
    전체오류 --> 불러오는중: 전체 다시 시도
    표시가능 --> 하위영역오류: 공지 또는 하위 활동 실패
    하위영역오류 --> 표시가능: 공용 방 재조회 뒤 해당 영역 성공
    표시가능 --> 불러오는중: 화면 복귀·날짜 확인·새로고침
    표시가능 --> 인증확인: NOT_FOUND
    하위영역오류 --> 인증확인: NOT_FOUND
```

- 요청은 시작한 `groupId`, 날짜, 화면 세대가 현재 맥락과 같을 때만 반영한다.
- 최초 상세 실패와 기존 detail 없음은 전체 오류다. detail이 준비된 뒤에만 공지·하위 활동의 늦은 실패가 다른 성공 영역을 비우거나 집중 진입을 막지 않는다.
- 현행 오류 버튼은 detail·공지·하위 활동을 함께 다시 요청하는 공용 `reload`를 사용한다. 성공·실패 결과는 영역별로만 반영하며, 특정 영역 요청만 재시도하는 구현은 아직 없다.
- 현재 `GroupRoomScreen`은 detail의 `MEMBER_ONLY|NOT_FOUND` 모두에서 `onLeft()`를 호출한다. 서버 `getGroupDetail`은 user active 조회와 group 조회에 `NOT_FOUND`, 그 뒤 membership 조회에 `MEMBER_ONLY`를 사용하므로 `NOT_FOUND` 즉시 복귀는 비활성 계정을 소속 없음 성공처럼 처리할 수 있어 미구현 목표와 다르다.
- 목표에서 `MEMBER_ONLY`는 활성 인증 뒤 요청자 미소속이라는 사후조건이면 직접 수렴한다. `NOT_FOUND`는 먼저 인증 상태를 재확인한다. 비활성·탈퇴 계정이면 성공 이벤트·성공 표시 없이 세션을 안전 복구한다.
- 인증이 유효한 `NOT_FOUND`는 최신 detail 성공이면 현재 방을 유지하고, 성공한 전체 목록 또는 명확한 최신 membership scope가 group 부재·미소속을 확인할 때만 `onLeft`로 목록/탐색에 복귀한다. 확인 실패·의미 불명은 기존 detail을 보존하거나 기존 detail이 없으면 전체 오류와 명시 재시도로 남긴다.
- 네트워크 오류는 재시도 상태다. `NOT_FOUND`를 포함해 확인 전에는 소속 없음으로 바꾸지 않는다.

## 2. 집중 진입과 방 복귀

```mermaid
sequenceDiagram
    participant U as 사용자
    participant R as 그룹방
    participant F as 집중 화면
    U->>R: 이 그룹으로 집중
    R->>F: initialGroupId + entrySource=group_room 전달
    F->>F: FocusCategory → FocusSession source 보존
    F->>F: FocusSession 최초 진입 시 entry_source=group_room 1회
    Note over R,F: marker API 성공과 독립 · rerender 재발행 없음
    F-->>R: 뒤로 또는 세션 종료
    R->>R: 현재 날짜의 방 정보 재확인
```

- ✅ `initialGroupId` 전달과 복귀 뒤 재조회는 구현되어 있다.
- ⬜ 공통 Focus route/helper가 `group_room|home_fab|unknown`을 `FocusCategory → FocusSession`에 보존하고 최초 진입 이벤트 payload에 싣는 변경은 아직 구현되지 않았다. `group_card`는 02 작업 패키지가 같은 공통 경계를 사용한다. source를 `initialGroupId`에서 추론하지 않는다.
- ⬜ 카드 CTA는 새 비식별 `interaction_id`를 `entrySource=group_card`와 함께 Room 또는 Focus route context에 넣어야 한다. Room은 최초 detail 성공 렌더에서, Focus는 최초 FocusSession 결과에서 같은 값을 정확히 한 번만 소비한다. FAB·외부 진입은 값 없이 시작하고 route 재사용·A 취소 뒤 B 성공은 이전 값을 재사용하지 않는다. 첫 결과 전 app background·예상 route chain 이탈·target unmount에는 pending 키를 제거하고, 재개 뒤 결과 이벤트에는 키를 싣지 않는다. 이벤트 사전·귀속 window는 [공통 분석 계약](../../shared/analytics.md)을 따른다.
- ⬜ 집중 버튼을 같은 순간 빠르게 두 번 누를 때 navigation을 정확히 한 번만 수락하는 잠금은 아직 없다.
- 🟡 날짜 변경은 포그라운드 복귀·수동 새로고침에서 확인한다. 화면을 계속 연 채 자정을 넘기는 자동 경계 감지는 아직 없다.

## 3. 공지 변경

```mermaid
flowchart TD
    Intent["공지 작성 · 수정 · 삭제"] --> Busy{"같은 행동 처리 중?"}
    Busy -->|예| Ignore["추가 제출 없음"]
    Busy -->|아니오| Send["서버 요청"]
    Send -->|성공| Reload["공지 목록 재조회"]
    Send -->|실패| Inline["입력 또는 현재 목록 유지<br/>오류 표시"]
    Reload --> Render["서버 최신 목록 표시"]
```

- 공지 권한은 화면 표시와 별개로 서버가 요청 시 다시 검증한다.
- 성공 응답 뒤 서버 목록으로 수렴하며, 실패한 변경을 낙관적으로 남기지 않는다.

## 4. 하위 기능 경계

```mermaid
flowchart LR
    Room["그룹방"] --> Core["멤버 · 공지 · 집중 진입"]
    Room --> Challenge["챌린지 영역"]
    Challenge --> Separate["별도 챌린지 PRD · HLD · LLD"]
    Challenge -.-> Independent["독립 로딩 · 오류<br/>그룹방 핵심을 막지 않음"]
```

이 문서는 챌린지의 상세 상태를 정의하거나 구현 완료로 판정하지 않는다. 그룹방은 해당 기능의 진입점과 실패 격리만 보장한다.

## 5. 검증 상태

| 검증                                                                                                           | 상태                                                        |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 최초 상세 실패 시 전체 오류·다시 시도, detail 성공 뒤 공지·하위 영역 실패 시 다른 영역과 집중 진입 유지        | ✅ 구현·화면 테스트 있음                                    |
| 다른 `groupId`·날짜·화면의 늦은 응답 폐기                                                                      | ✅ 구현됨                                                   |
| detail `MEMBER_ONLY` 직접 수렴                                                                                 | ✅ 현행 `onLeft`; 서버 활성 인증 뒤 멤버십 부재 코드        |
| detail `NOT_FOUND`의 인증 재확인·세션 복구·최신 scope 재확인                                                   | ⬜ 미구현; 현행은 즉시 `onLeft`                             |
| `NOT_FOUND` 재확인 실패·의미 불명에서 안전 상태 유지·오류 재시도                                               | ⬜ 미구현                                                   |
| 공지 권한 변경·실패·재조회                                                                                     | ✅ 구현·테스트 있음                                         |
| 공지·하위 영역 오류 버튼의 공용 재조회와 성공 영역 보존                                                        | 🟡 현행 구현·호출 범위 회귀 테스트 보강 필요                |
| 특정 오류 영역의 요청만 다시 보내는 영역별 retry                                                               | ⬜ 미구현                                                   |
| 집중 버튼 빠른 이중 탭 차단                                                                                    | ⬜ 미구현                                                   |
| 공통 Focus route의 `group_room`, `home_fab`, `unknown` 보존·정규화와 최초 진입 이벤트 1회                      | ⬜ 미구현                                                   |
| 카드 CTA `interaction_id`의 Room·Focus exact pair, A 취소→B 성공·route 재사용·첫 결과 전 background stale 차단 | ⬜ 미구현·E2E 필요                                          |
| 열린 화면에서 자정 경계 자동 갱신                                                                              | ⬜ 미구현                                                   |
| 권한 변경과 제출이 겹치는 전체 E2E                                                                             | ⬜ 검증 미작성                                              |
| 비활성·탈퇴 계정 `NOT_FOUND`는 세션 복구만 하고 성공 복귀·성공 이벤트가 없는 E2E                               | ⬜ 검증 미작성                                              |
| 인증 유효 `NOT_FOUND`의 detail/list 재확인: group 부재·미소속만 복귀, detail 성공·확인 실패는 유지/오류        | ⬜ 검증 미작성                                              |
| 챌린지 상세 검증                                                                                               | [챌린지 LLD](../../../challenge/low-level-design.md)로 이관 |
